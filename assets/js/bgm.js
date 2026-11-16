/* 蟳埔花事 · 首页背景音乐
 *
 * 音源有两套，按可用性自动选：
 *   1) assets/audio/bgm.mp3 —— 你往这个位置放一个 mp3 就会优先生效
 *   2) 没有文件时，用 Web Audio 实时合成「海风 + 风铃」的氛围音，
 *      不占带宽、没有版权问题，调性也贴近蟳埔的海边渔村
 *
 * 浏览器不允许无交互自动播放，必须由访客点一下右下角的按钮。
 * 这是规范层面的限制，任何站点都绕不过去。
 */
(function () {
  'use strict';

  var WANTED_KEY = 'xb-bgm-wanted';

  /* ---------------- 按钮 ---------------- */

  var btn = document.createElement('button');
  btn.className = 'bgm-toggle';
  btn.type = 'button';
  btn.setAttribute('aria-label', '播放背景音乐');
  btn.setAttribute('aria-pressed', 'false');
  btn.title = '背景音乐';
  btn.innerHTML =
    '<svg class="bgm-toggle__on" viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M9 17.5V5.2l10-2v12.3"/>' +
    '<circle cx="6" cy="17.5" r="3"/>' +
    '<circle cx="16" cy="15.5" r="3"/>' +
    '</svg>' +
    '<svg class="bgm-toggle__off" viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M9 17.5V5.2l10-2v12.3"/>' +
    '<circle cx="6" cy="17.5" r="3"/>' +
    '<circle cx="16" cy="15.5" r="3"/>' +
    '<path d="M3 3l18 18"/>' +
    '</svg>';

  function mount() {
    document.body.appendChild(btn);
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount);
  } else {
    mount();
  }

  /* ---------------- 音频文件探测 ----------------
     依次尝试几种常见格式，第一个能播的就用它。
     都找不到就退回下面的 Web Audio 合成。 */

  var CANDIDATES = [
    'assets/audio/bgm.mp3',
    'assets/audio/bgm.m4a',
    'assets/audio/bgm.ogg',
    'assets/audio/bgm.wav'
  ];
  var audioEl = null;

  (function probeFile(i) {
    if (i >= CANDIDATES.length) return;
    var a;
    try {
      a = new Audio();
    } catch (e) {
      return;
    }
    a.preload = 'metadata';
    a.loop = true;
    a.volume = 0.55;
    a.addEventListener('canplaythrough', function () { audioEl = a; }, { once: true });
    a.addEventListener('error', function () { probeFile(i + 1); }, { once: true });
    try {
      a.src = CANDIDATES[i];
      a.load();
    } catch (e) {
      probeFile(i + 1);
    }
  })(0);

  /* ---------------- Web Audio 合成 ---------------- */

  var actx = null;
  var master = null;
  var delayNode = null;
  var chimeTimer = null;
  var playing = false;

  // 五声音阶（C D E G A C），偏高音区，像檐角的风铃
  var SCALE = [523.25, 587.33, 659.25, 783.99, 880.0, 1046.5];

  function build() {
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    try {
      actx = new AC();
    } catch (e) {
      return false;
    }

    master = actx.createGain();
    master.gain.value = 0;
    master.connect(actx.destination);

    /* 海风：白噪声过低通，再用极慢的 LFO 摆动音量做「呼吸」 */
    var len = Math.floor(actx.sampleRate * 2);
    var buf = actx.createBuffer(1, len, actx.sampleRate);
    var ch = buf.getChannelData(0);
    for (var i = 0; i < len; i++) ch[i] = Math.random() * 2 - 1;

    var noise = actx.createBufferSource();
    noise.buffer = buf;
    noise.loop = true;

    var lp = actx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 380;
    lp.Q.value = 0.7;

    var noiseGain = actx.createGain();
    noiseGain.gain.value = 0.5;

    noise.connect(lp);
    lp.connect(noiseGain);
    noiseGain.connect(master);

    var lfo = actx.createOscillator();
    lfo.frequency.value = 0.055;
    var lfoAmt = actx.createGain();
    lfoAmt.gain.value = 0.22;
    lfo.connect(lfoAmt);
    lfoAmt.connect(noiseGain.gain);

    noise.start();
    lfo.start();

    /* 简易混响：带反馈的延迟，让风铃有余韵 */
    delayNode = actx.createDelay(1.2);
    delayNode.delayTime.value = 0.36;
    var fb = actx.createGain();
    fb.gain.value = 0.3;
    var wet = actx.createGain();
    wet.gain.value = 0.32;
    delayNode.connect(fb);
    fb.connect(delayNode);
    delayNode.connect(wet);
    wet.connect(master);

    return true;
  }

  function chime() {
    if (!playing || !actx || !master) return;
    var t = actx.currentTime;
    var freq = SCALE[Math.floor(Math.random() * SCALE.length)];

    var osc = actx.createOscillator();
    var osc2 = actx.createOscillator();
    var g = actx.createGain();

    osc.type = 'sine';
    osc2.type = 'sine';
    osc.frequency.value = freq;
    osc2.frequency.value = freq * 1.0035; // 轻微失谐，更像金属片

    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.16, t + 0.03);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 3.6);

    osc.connect(g);
    osc2.connect(g);
    g.connect(master);
    g.connect(delayNode);

    osc.start(t);
    osc2.start(t);
    osc.stop(t + 3.8);
    osc2.stop(t + 3.8);

    chimeTimer = setTimeout(chime, 5200 + Math.random() * 9000);
  }

  /* ---------------- 开关 ---------------- */

  function remember(v) {
    try {
      localStorage.setItem(WANTED_KEY, v);
    } catch (e) {
      /* 无痕模式写不了，忽略 */
    }
  }

  function start() {
    var useFile = audioEl && audioEl.readyState >= 2;

    if (useFile) {
      try {
        audioEl.currentTime = 0;
        var p = audioEl.play();
        if (p && p.catch) p.catch(function () { /* 被拦下就退回合成 */ });
      } catch (e) {
        useFile = false;
      }
    }

    if (!useFile) {
      if (!actx && !build()) {
        btn.hidden = true; // 浏览器太老，直接不显示
        return;
      }
      if (actx.state === 'suspended') actx.resume();
      master.gain.cancelScheduledValues(actx.currentTime);
      master.gain.setValueAtTime(master.gain.value, actx.currentTime);
      master.gain.linearRampToValueAtTime(0.35, actx.currentTime + 2.4);
      if (!chimeTimer) chimeTimer = setTimeout(chime, 1600);
    }

    playing = true;
    btn.classList.add('is-on');
    btn.setAttribute('aria-pressed', 'true');
    btn.setAttribute('aria-label', '暂停背景音乐');
    remember('1');
  }

  function stop() {
    if (audioEl) {
      try { audioEl.pause(); } catch (e) { /* 忽略 */ }
    }
    if (actx && master) {
      master.gain.cancelScheduledValues(actx.currentTime);
      master.gain.setValueAtTime(master.gain.value, actx.currentTime);
      master.gain.linearRampToValueAtTime(0, actx.currentTime + 0.6);
    }
    if (chimeTimer) {
      clearTimeout(chimeTimer);
      chimeTimer = null;
    }

    playing = false;
    btn.classList.remove('is-on');
    btn.setAttribute('aria-pressed', 'false');
    btn.setAttribute('aria-label', '播放背景音乐');
    remember('0');
  }

  btn.addEventListener('click', function () {
    if (playing) stop();
    else start();
  });

  /* 上次主动关掉的，这次就别用高亮去打扰 */
  try {
    if (localStorage.getItem(WANTED_KEY) === '0') btn.classList.add('is-quiet');
  } catch (e) {
    /* 忽略 */
  }

  /* 切到后台标签页时淡出，回来再淡入，避免一直响 */
  document.addEventListener('visibilitychange', function () {
    if (!playing || !actx || !master) return;
    if (document.hidden) {
      master.gain.cancelScheduledValues(actx.currentTime);
      master.gain.setValueAtTime(master.gain.value, actx.currentTime);
      master.gain.linearRampToValueAtTime(0, actx.currentTime + 0.4);
    } else {
      master.gain.cancelScheduledValues(actx.currentTime);
      master.gain.setValueAtTime(master.gain.value, actx.currentTime);
      master.gain.linearRampToValueAtTime(0.35, actx.currentTime + 1.2);
    }
  });
})();
