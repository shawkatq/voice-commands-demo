import { Utils } from './utils.js'

var Meyda = require('meyda')
var DynamicTimeWarping = require('dynamic-time-warping')

export class Recognize {

    /******************************************************************************
  * Local Recognition and MFCC/DTW calculations 
  * MFCC by Meyda: https://github.com/meyda/meyda
  * DTW: https://github.com/GordonLesti/dynamic-time-warping
  ******************************************************************************/

    static startTime = null;
    static endTime = null;
    static calibMode = false;
    static mfccHistoryArr = [];
    static mfccHistoryCunters = [];
    static dictionary = ['one', 'two', 'three'];
    static bufferSize = 2048;
    static _buffArrSize = 40;      // 40   / 70
    static _minNumberOfVariants = 2;
    static _minKnnConfidence = 0;
    static _minDTWDist = 1000;
    static K_factor = 3;

    static mfccDistArr = [];

    static bufferMfcc;
    static buffer = {};

    static train(_buffer, transcript, setStateFunc) {
        setStateFunc("training");
        this.buffer = _buffer;
        Meyda.bufferSize = this.bufferSize;
        
        this.bufferMfcc = this.createMfccMetric();
        
        // save current mfcc for next recognitions
        this.mfccHistoryArr.push({
            mfcc: this.bufferMfcc,
            transcript: transcript
        });
        if (!this.mfccHistoryCunters[transcript] && this.mfccHistoryCunters[transcript] !== 0)
            this.mfccHistoryCunters[transcript] = 0;
        this.mfccHistoryCunters[transcript]++;

        setStateFunc("training saved");
        return true;
    }

    static recognize(_buffer, setStateFunc) {
        this.buffer = _buffer;
        Meyda.bufferSize = this.bufferSize;

        this.bufferMfcc = this.createMfccMetric();

        this.startTime = Utils.getTimestamp();
        setStateFunc("recognizing");
        this.calculateDistanceArr();
        // get closest one using knn
        var knnClosest;
        if (this.K_factor <= this.mfccHistoryArr.length) {
            knnClosest = this.getMostSimilarKnn(this.mfccDistArr, this.compareMfcc, this.K_factor);
            if (knnClosest &&
                (this.mfccHistoryCunters[knnClosest.transcript] < this._minNumberOfVariants
                    || knnClosest.confidence < this._minKnnConfidence))
                knnClosest = null;

            if (knnClosest && knnClosest.transcript !== "") {
                // save current mfcc for next recognitions
                this.mfccHistoryArr.push({
                    mfcc: this.bufferMfcc,
                    transcript: knnClosest.transcript
                });
                if (!this.mfccHistoryCunters[knnClosest.transcript] && this.mfccHistoryCunters[knnClosest.transcript] !== 0)
                    this.mfccHistoryCunters[knnClosest.transcript] = 0;
                this.mfccHistoryCunters[knnClosest.transcript]++;

                // send back the result
                knnClosest.closestFromDictionary = knnClosest.transcript;
                
            }

        }

        if (!knnClosest) {
            this.endTime = Utils.getTimestamp();
            setStateFunc("not recognized" );
            console.log("recognition locally failed or returned no good result (" + (this.endTime - this.startTime) + " ms)");
            return null;
        }
        setStateFunc("recognized" );
        return knnClosest;
    };


    // calculate distance from dictionary mfcc history
    static calculateDistanceArr() {
        for (var i = 0; i < this.mfccHistoryArr.length; i++) {
            if (this.isInDictionary(this.mfccHistoryArr[i].transcript)) {
                var dtw = new DynamicTimeWarping(this.mfccHistoryArr[i].mfcc, this.bufferMfcc, this.EuclideanDistance);
                var dist = dtw.getDistance();
                this.mfccDistArr.push({
                    dist: dist,
                    transcript: this.mfccHistoryArr[i].transcript
                });
            }
        }
    }


    // search in dictionary
    static isInDictionary(word) {
        for (var i = 0; i < this.dictionary.length; i++) {
            if (this.dictionary[i] === word)
                return true;
        }
        return false;
    }
    // get the most similar transcript from audio mfcc history array, using Knn Algorithm
    static getMostSimilarKnn(Items, CompFunc, k) {
        if (!Items || Items.length === 0)
            return;
        if (k > Items.length)
            return;
        var items = Items;
        var compFunc = CompFunc;

        items.sort(compFunc);
        var kArr = items.slice(0, k);
        var simArr = [];
        var maxElm = {
            transcript: '',
            weight: 0,
            confidence: 0
        };

        for (var i = 0; i < kArr.length; i++) {
            if (kArr[i].dist > this._minDTWDist)
                continue;

            if (!simArr[kArr[i].transcript])
                simArr[kArr[i].transcript] = {
                    weight: 1000 / kArr[i].dist,
                }
            else {
                simArr[kArr[i].transcript].weight = simArr[kArr[i].transcript].weight + 1000 / kArr[i].dist;
            }

            if (maxElm.weight < simArr[kArr[i].transcript].weight) {
                maxElm = {
                    transcript: kArr[i].transcript,
                    weight: simArr[kArr[i].transcript].weight,
                };
            }
        }

        if (maxElm && maxElm.transcript === '')
            maxElm = null;

        if (maxElm) {
            // calculate confidence
            var sum = 0, count = 0;
            for (i = 0; i < items.length; i++) {
                if (items[i].transcript === maxElm.transcript) {
                    sum = sum + items[i].dist;
                    count++;
                }
            }
            maxElm.confidence = this.getGaussianKernel(sum / count).toFixed(4);
        }
        return maxElm;
    }
    // 
    static getGaussianKernel(t) {
        return Math.pow(Math.E, -1 / 2 * Math.pow(t / 1000, 2));
    }
    // calculate current audio mfcc
    static createMfccMetric() {
        var mfccMetricArr = [];
        for (var i = 0; i < this._buffArrSize; i++) {
            if (this.buffer[i] && this.buffer[i].length === this.bufferSize) {
                var mfccMetric = Meyda.extract("mfcc", this.buffer[i]);
                mfccMetricArr.push(mfccMetric)
            }
        }

        return mfccMetricArr;
    }
    // Euclidean Distance between two victors
    static EuclideanDistance(p, q) {
        var d = 0;
        if (p.length !== q.length)
            return -1;
        for (var i = 0; i < p.length; i++) {
            d = d + Math.pow(p[i] - q[i], 2);
        }
        return Math.sqrt(d);
    }
    // Mfcc object comparison
    static compareMfcc(a, b) {
        if (a.dist < b.dist)
            return -1;
        if (a.dist > b.dist)
            return 1;
        return 0;
    }
}