import React, { Component } from 'react';
import './App.css';
import { Utils } from './utils.js'
import { Recognize } from './recognize';

var hark = require('hark')

class App extends Component {

  constructor(props) {
    super(props);
    this.state = {
      msg: "click start",
      modeMsg: "",
      statusMsg: "",
      trained: false,
      currentTrainingIndex: null,
      result: ''
    }
    /******************************************************************************************************/

    /*********  Voice *********/
    this.audioContextType = null;
    this.localstream = null;
    this.context = null;
    this.track = null;
    this.node = null;
    this.recording = true;
    this.speechHark = null;
    this.leftchannel = [];

    /********* Settings *********/
    this._stopRecTimeout = 1000;
    this._threshold = -50; // voice dB
    this._harkInterval = 100;
    this.recordingLength = 0;
    this.numChannels = 1;
  }

  /**
   * This function will run if the microphone was successfully acquired.
   * Here we record the data and make a signal when there is a speech start recognized
   */
  onMediaSuccess = (stream) => {
    if (!this.state.trained) {
      this.setState({
        currentTrainingIndex: 0,
        msg: "say the next word loud and clear, and wait until we process it.  ===>   " + Recognize.dictionary[0]
      });
    }
    this.audioContextType = window.AudioContext || window.webkitAudioContext;
    this.localStream = stream;
    this.track = this.localStream.getTracks()[0];
    // create the MediaStreamAudioSourceNode
    // Setup Audio Context
    this.context = new this.audioContextType();
    var source = this.context.createMediaStreamSource(this.localStream);

    // create a ScriptProcessorNode
    if (!this.context.createScriptProcessor) {
      this.node = this.context.createJavaScriptNode(Recognize.bufferSize, this.numChannels, this.numChannels);
    } else {
      this.node = this.context.createScriptProcessor(Recognize.bufferSize, this.numChannels, this.numChannels);
    }

    // listen to the audio data, and record into the buffer, this is important to catch the fraction of second before the speech started.
    this.node.onaudioprocess = (e) => {

      var left = e.inputBuffer.getChannelData(0);

      if (!this.recording) return;
      if (this.leftchannel.length < Recognize._buffArrSize) {
        this.leftchannel.push(new Float32Array(left));
        this.recordingLength += this.bufferSize;
      }
      else {
        this.leftchannel.splice(0, 1);
        this.leftchannel.push(new Float32Array(left));
      }
    }

    // connect the ScriptProcessorNode with the input audio
    source.connect(this.node);
    this.node.connect(this.context.destination);

    // hark: https://github.com/otalk/hark
    // detect a speech start
    this.speechHark = hark(this.localStream, { interval: this._harkInterval, threshold: this._threshold, play: false, recoredInterval: this._stopRecTimeout });
    this.speechHark.on('speaking', () => {
      this.setState({ statusMsg: "recoding" });
      setTimeout(() => { this.stopRec(); }, this._stopRecTimeout);
    });
    this.speechHark.on('stopped_speaking', () => {
    });
  }

  /**
   * stop recording data in the buffer, and process the signal
   */
  stopRec = () => {
    this.setState({ statusMsg: 'stopped recoding' });
    this.recording = false;
    var internalLeftChannel = this.leftchannel.slice(0);
    var internalRecordingLength = this.recordingLength;

    // create blob to process it
    var blob = Utils.bufferToBlob(internalLeftChannel, internalRecordingLength);

    if (!blob)
      return;

    // create a WAV file to listen to the recorded data
    Utils.getVoiceFile(blob, 0);

    var reader = new window.FileReader();
    reader.readAsDataURL(blob);

    // read the blob and start processing according to the system state (trained or not)
    reader.onloadend = () => {
      if (this.state.trained) {
        let result = Recognize.recognize(internalLeftChannel, this.setStateMsgFunc);
        if (result) {
          this.setState({
            msg: "Great! the result is ===> " + result.transcript + " <=== try more."
          });
        }
        else {
          this.setState({
            msg: "Didn't Got it! please try to Again loud and clear."
          });
        }
        console.log(result);
      }
      else {
        let success = Recognize.train(internalLeftChannel, Recognize.dictionary[this.state.currentTrainingIndex % Recognize.dictionary.length], this.setStateMsgFunc);
        this.traingNextWord(success);

      }
    }

    this.leftchannel.length = 0;
    this.recordingLength = 0;
    this.recording = true;
  };

  /**
   * Move to the next word to train the system.
   * Train the whole dictionary twice
   */
  traingNextWord = (success) => {
    if (success) {
      // next word
      let i = this.state.currentTrainingIndex + 1;
      if (i > Recognize.dictionary.length * 2 - 1) {
        this.setState({
          trained: true,
          currentTrainingIndex: i,
          msg: "training is finished, now we will try to guess what you are trying to say from the trained vocabulary.",
          modeMsg: "recognizing mode"
        })
      }
      else {
        this.setState({
          currentTrainingIndex: i,
          msg: "Good! say the next word loud and clear, and wait until we process it.  ===>  " + Recognize.dictionary[i % Recognize.dictionary.length]
        })
      }
    }
    else {
      this.setState({
        msg: "we didn't got it, try again, say the next word loud and clear, and wait until we process it.    " + Recognize.dictionary[this.state.currentTrainingIndex % Recognize.dictionary.length]
      })
    }
  }

  setStateMsgFunc = (msg) => {
    this.setState({ statusMsg: msg });
  }

  stopUserMediaTrack = () => {
    if (this.track) this.track.stop();
  }

  /**
   * Start listening to media devices
   */
  async startListening() {

    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    this.onMediaSuccess(stream);

  };

  /**
   * Stop listening to media devices, and empty all buffers and streams
   */
  stopListening = () => {
    this.recording = false;
    if (this.leftchannel) {
      this.leftchannel.length = 0;
      this.leftchannel = [];
    }
    this.localStream = null;
    this.recordingLength = 0;
    if (this.speechHark) this.speechHark.stop();
    if (this.stopUserMediaTrack) this.stopUserMediaTrack();
  };

  /******************************************************************************************************/
  /** React */

  start = () => {
    this.startListening()
    if (!this.state.trained) {
      this.setState({
        modeMsg: "training mode",
      });
    }
    else {
      this.setState({
        modeMsg: "recognizing mode"
      });
    }
  }

  stop = () => {
    this.stopListening()
    this.setState({
      statusMsg: "stoped"
    });
  }

  render() {
    return (
      <div className="App">
        <div className="row">
          <button onClick={this.start}>Start</button>
          <button onClick={this.stop}>Stop</button>
        </div>
        <div className="msgs">
          <span>{this.state.modeMsg}</span>
        </div>
        <div className="msgs">
          <span>{this.state.msg}</span>
        </div>
        <div className="msgs">
          <span>{this.state.statusMsg}</span>
        </div>
        <div id="audios-container"></div>
      </div>
    );
  }
}




export default App;
