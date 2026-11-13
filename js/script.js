(() => {
  'use strict';

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
  const screens = $$('.screen');
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const state = {
    soundEnabled: true,
    audioContext: null,
    tomatoCount: 0,
    activeScreen: 'intro',
    revealTimers: [],
    revealStarted: false,
    photoRequested: false,
    activePointer: null,
    lastPointerLaunch: 0,
    lastDragEnd: 0,
  };

  const milestoneMessages = new Map([
    [1, 'Honestly, deserved.'],
    [3, 'Okay, I see your point.'],
    [5, 'I’m beginning to understand the consequences.'],
    [10, 'At this point, I’m becoming tomato sauce.'],
    [15, 'I would like to formally apologise to the tomato community as well.'],
    [20, 'I have learned absolutely nothing about dodging.'],
  ]);

  const soundToggle = $('#soundToggle');
  const soundLabel = $('#soundLabel');
  const countdownPanel = $('#countdownPanel');
  const countdownNumber = $('#countdownNumber');
  const revealCurtain = $('#revealCurtain');
  const revealedPerson = $('#revealedPerson');
  const revealButton = $('#revealButton');
  const tomatoCount = $('#tomatoCount');
  const milestoneMessage = $('#milestoneMessage');
  const gameArena = $('#gameArena');
  const targetFrame = $('#gamePhotoFrame');
  const splatterLayer = $('#splatterLayer');
  const projectileLayer = $('#projectileLayer');
  const aimGuide = $('#aimGuide');
  const dragGhost = $('#dragGhost');

  // Reveal audio: put your file at assets/audio/reveal.mp3 and it plays the moment the photo appears.
  const REVEAL_AUDIO_SRC = 'assets/audio/reveal.mp3';
  const revealAudio = new Audio(REVEAL_AUDIO_SRC);
  revealAudio.preload = 'auto';
  let revealAudioMissing = false;
  revealAudio.addEventListener('error', () => {
    revealAudioMissing = true;
    console.info(`Add your audio file at ${REVEAL_AUDIO_SRC} to play a sound when the photo is revealed.`);
  });

  function stopRevealAudio() {
    revealAudio.pause();
    revealAudio.currentTime = 0;
  }

  // Phones only allow audio that starts from a tap, and the reveal fires a couple of seconds
  // after one. Playing it silently inside the tap handler "unlocks" it for the real play later.
  function primeRevealAudio() {
    if (revealAudioMissing) return;
    revealAudio.muted = true;
    const attempt = revealAudio.play();
    if (!attempt || typeof attempt.then !== 'function') {
      revealAudio.pause();
      revealAudio.currentTime = 0;
      revealAudio.muted = false;
      return;
    }
    attempt
      .then(() => {
        revealAudio.pause();
        revealAudio.currentTime = 0;
      })
      .catch(() => {})
      .finally(() => { revealAudio.muted = false; });
  }

  function playRevealPayoff() {
    // Skip if the person already left the reveal screen while the countdown was running.
    if (!state.soundEnabled || state.activeScreen !== 'reveal') return;
    // No file (or the browser refused to play it): fall back to the built-in flourish.
    if (revealAudioMissing) {
      playRevealFlourish();
      return;
    }
    revealAudio.currentTime = 0;
    revealAudio.muted = false;
    revealAudio.play().catch(() => playRevealFlourish());
  }

  function showScreen(screenId) {
    const next = document.getElementById(screenId);
    if (!next || state.activeScreen === screenId) return;

    screens.forEach((screen) => {
      const active = screen === next;
      screen.hidden = !active;
      screen.classList.toggle('is-active', active);
      screen.setAttribute('aria-hidden', String(!active));
    });
    state.activeScreen = screenId;
    // Let the reveal sound carry on into the game, but not onto the letter or intro.
    if (screenId !== 'reveal' && screenId !== 'game') stopRevealAudio();

    const focusTarget = next.querySelector('h1, h2, button');
    if (focusTarget) {
      focusTarget.setAttribute('tabindex', '-1');
      focusTarget.focus({ preventScroll: true });
    }
    window.scrollTo({ top: 0, behavior: reducedMotion ? 'auto' : 'smooth' });
  }

  function setSoundEnabled(enabled) {
    state.soundEnabled = Boolean(enabled);
    soundToggle.setAttribute('aria-pressed', String(state.soundEnabled));
    soundToggle.setAttribute('aria-label', state.soundEnabled ? 'Mute sound effects' : 'Unmute sound effects');
    soundLabel.textContent = state.soundEnabled ? 'Sound on' : 'Sound off';
    $('.sound-icon', soundToggle).textContent = state.soundEnabled ? '♪' : '∅';
    if (!state.soundEnabled) revealAudio.pause();
  }

  function getAudioContext() {
    if (!state.audioContext) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) return null;
      try {
        state.audioContext = new AudioContextClass();
      } catch (error) {
        console.warn('Audio is unavailable in this browser.', error);
        return null;
      }
    }
    if (state.audioContext.state === 'suspended') {
      state.audioContext.resume().catch(() => {});
    }
    return state.audioContext;
  }

  function playTone(context, frequency, startAt, duration, options = {}) {
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = options.type || 'sine';
    oscillator.frequency.setValueAtTime(Math.max(20, frequency), startAt);
    if (options.endFrequency) {
      oscillator.frequency.exponentialRampToValueAtTime(Math.max(20, options.endFrequency), startAt + duration);
    }
    gain.gain.setValueAtTime(0.0001, startAt);
    gain.gain.exponentialRampToValueAtTime(options.volume || 0.12, startAt + Math.min(0.035, duration / 3));
    gain.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start(startAt);
    oscillator.stop(startAt + duration + 0.025);
  }

  function playNoise(context, startAt, duration, volume, filterFrequency = 1600) {
    const sampleRate = context.sampleRate;
    const buffer = context.createBuffer(1, Math.max(1, Math.floor(sampleRate * duration)), sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i += 1) {
      const fade = 1 - i / data.length;
      data[i] = (Math.random() * 2 - 1) * fade;
    }
    const source = context.createBufferSource();
    const filter = context.createBiquadFilter();
    const gain = context.createGain();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(filterFrequency, startAt);
    filter.Q.value = 0.7;
    gain.gain.setValueAtTime(volume, startAt);
    gain.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);
    source.buffer = buffer;
    source.connect(filter);
    filter.connect(gain);
    gain.connect(context.destination);
    source.start(startAt);
    source.stop(startAt + duration + 0.02);
  }

  // Original Web Audio reveal sting: rising suspense, a soft drumroll, then a comic flourish.
  function playRevealSound() {
    if (!state.soundEnabled) return;
    const context = getAudioContext();
    if (!context) return;
    const now = context.currentTime + 0.04;

    const rise = context.createOscillator();
    const riseGain = context.createGain();
    rise.type = 'triangle';
    rise.frequency.setValueAtTime(165, now);
    rise.frequency.exponentialRampToValueAtTime(520, now + 1.95);
    riseGain.gain.setValueAtTime(0.0001, now);
    riseGain.gain.linearRampToValueAtTime(0.055, now + 0.2);
    riseGain.gain.setValueAtTime(0.055, now + 1.65);
    riseGain.gain.exponentialRampToValueAtTime(0.0001, now + 2.05);
    rise.connect(riseGain);
    riseGain.connect(context.destination);
    rise.start(now);
    rise.stop(now + 2.08);

    for (let i = 0; i < 13; i += 1) {
      const at = now + 1.05 + i * 0.085;
      playNoise(context, at, 0.075, 0.035 + i * 0.0015, 1850 + i * 45);
    }
  }

  // A little two-note brass-like flourish. It plays on the reveal only when there is no audio file.
  function playRevealFlourish() {
    if (!state.soundEnabled) return;
    const context = getAudioContext();
    if (!context) return;
    const now = context.currentTime + 0.02;
    playTone(context, 440, now, 0.34, { type: 'square', volume: 0.045, endFrequency: 560 });
    playTone(context, 660, now + 0.09, 0.52, { type: 'triangle', volume: 0.075, endFrequency: 880 });
    playTone(context, 220, now + 0.04, 0.42, { type: 'sine', volume: 0.09, endFrequency: 110 });
  }

  function playImpactSound() {
    if (!state.soundEnabled) return;
    const context = getAudioContext();
    if (!context) return;
    const now = context.currentTime + 0.005;
    playNoise(context, now, 0.17, 0.12, 520);
    playTone(context, 125, now, 0.19, { type: 'sine', volume: 0.10, endFrequency: 55 });
    playTone(context, 280, now + 0.015, 0.09, { type: 'triangle', volume: 0.035, endFrequency: 145 });
  }

  function clearRevealTimers() {
    state.revealTimers.forEach((timer) => window.clearTimeout(timer));
    state.revealTimers = [];
  }

  function queueRevealStep(callback, delay) {
    const timer = window.setTimeout(callback, delay);
    state.revealTimers.push(timer);
  }

  function requestPortraits() {
    if (state.photoRequested) return;
    state.photoRequested = true;
    $$('[data-portrait]').forEach((image) => {
      const frame = image.closest('[data-photo-frame]');
      image.addEventListener('load', () => frame.classList.add('has-photo'), { once: true });
      image.addEventListener('error', () => {
        frame.classList.remove('has-photo');
        console.info('Add your photograph at assets/images/me.jpg to replace the photo placeholder.');
      }, { once: true });
      image.src = 'assets/images/me.jpeg';
    });
  }

  function startReveal() {
    if (state.revealStarted) return;
    state.revealStarted = true;
    revealButton.disabled = true;
    revealButton.textContent = 'Preparing the reveal…';
    primeRevealAudio();
    playRevealSound();
    countdownPanel.hidden = false;

    const countdown = [
      { number: '3', delay: 0 },
      { number: '2', delay: 720 },
      { number: '1', delay: 1440 },
    ];
    countdown.forEach(({ number, delay }) => {
      queueRevealStep(() => {
        countdownNumber.textContent = number;
        countdownNumber.style.animation = 'none';
        // Restart the number entrance animation on every beat.
        void countdownNumber.offsetWidth;
        countdownNumber.style.animation = '';
      }, delay);
    });

    queueRevealStep(() => {
      countdownPanel.hidden = true;
      revealedPerson.hidden = false;
      playRevealPayoff();
      requestPortraits();
      const revealTitle = $('#revealTitle');
      revealTitle.focus?.({ preventScroll: true });
      $('#toGameButton').focus({ preventScroll: true });
    }, 2380);
  }

  function randomAimPoint() {
    const rect = targetFrame.getBoundingClientRect();
    const arenaRect = gameArena.getBoundingClientRect();
    const x = rect.left + rect.width * (0.18 + Math.random() * 0.64) - arenaRect.left;
    const y = rect.top + rect.height * (0.16 + Math.random() * 0.68) - arenaRect.top;
    return { x, y };
  }

  function aimedPoint(clientX, clientY) {
    const rect = targetFrame.getBoundingClientRect();
    const arenaRect = gameArena.getBoundingClientRect();
    // Dragging onto the portrait maps directly to a point on it. Releasing outside
    // still aims at the nearest point on the photograph, which is friendlier on mobile.
    const x = Math.min(0.94, Math.max(0.06, (clientX - rect.left) / rect.width));
    const y = Math.min(0.94, Math.max(0.06, (clientY - rect.top) / rect.height));
    return {
      x: rect.left + rect.width * x - arenaRect.left,
      y: rect.top + rect.height * y - arenaRect.top,
    };
  }

  function pointInsideRect(point, rect) {
    return point.x >= rect.left && point.x <= rect.right && point.y >= rect.top && point.y <= rect.bottom;
  }

  function showMilestone(message) {
    milestoneMessage.textContent = message;
    milestoneMessage.classList.remove('is-changing');
    void milestoneMessage.offsetWidth;
    milestoneMessage.classList.add('is-changing');
  }

  function addSplatter(pointInArena) {
    const frameRect = targetFrame.getBoundingClientRect();
    const arenaRect = gameArena.getBoundingClientRect();
    const localX = pointInArena.x - (frameRect.left - arenaRect.left);
    const localY = pointInArena.y - (frameRect.top - arenaRect.top);
    const splat = document.createElement('span');
    splat.className = 'splat';
    splat.style.left = `${(localX / frameRect.width) * 100}%`;
    splat.style.top = `${(localY / frameRect.height) * 100}%`;
    splat.style.setProperty('--splat-rotation', `${Math.round(Math.random() * 80 - 40)}deg`);
    for (let i = 1; i <= 3; i += 1) {
      const drop = document.createElement('i');
      drop.className = `splat-drop ${['one', 'two', 'three'][i - 1]}`;
      splat.append(drop);
    }
    splatterLayer.append(splat);
    playImpactSound();

    // Keep the DOM light during unlimited play while preserving the latest hits.
    const splats = $$('.splat', splatterLayer);
    if (splats.length > 45) splats[0].remove();
  }

  function registerHit(destination, targetRect) {
    if (!pointInsideRect(destination, targetRect)) return;
    state.tomatoCount += 1;
    tomatoCount.textContent = String(state.tomatoCount);
    addSplatter(destination);
    const message = milestoneMessages.get(state.tomatoCount);
    if (message) showMilestone(message);
    else if (state.tomatoCount === 2) showMilestone('The evidence is piling up.');
  }

  function throwTomato(launcher, destination) {
    if (!launcher || !destination) return;
    const arenaRect = gameArena.getBoundingClientRect();
    const launcherRect = launcher.getBoundingClientRect();
    const targetRectAbs = targetFrame.getBoundingClientRect();
    const targetRect = {
      left: targetRectAbs.left - arenaRect.left,
      right: targetRectAbs.right - arenaRect.left,
      top: targetRectAbs.top - arenaRect.top,
      bottom: targetRectAbs.bottom - arenaRect.top,
    };
    const start = {
      x: launcherRect.left + launcherRect.width / 2 - arenaRect.left,
      y: launcherRect.top + launcherRect.height / 2 - arenaRect.top,
    };

    // Keep the landing point inside the actual visible photo frame (the collision box).
    const landing = {
      x: Math.min(targetRect.right - 4, Math.max(targetRect.left + 4, destination.x)),
      y: Math.min(targetRect.bottom - 4, Math.max(targetRect.top + 4, destination.y)),
    };
    const projectile = document.createElement('span');
    projectile.className = 'projectile';
    projectile.textContent = '🍅';
    projectile.style.left = `${start.x - 17}px`;
    projectile.style.top = `${start.y - 17}px`;
    projectileLayer.append(projectile);

    const dx = landing.x - start.x;
    const dy = landing.y - start.y;
    const animation = projectile.animate([
      { transform: 'translate(0px, 0px) rotate(0deg) scale(.92)' },
      { transform: `translate(${dx * 0.48}px, ${dy * 0.48 - 42}px) rotate(250deg) scale(1.08)`, offset: 0.48 },
      { transform: `translate(${dx}px, ${dy}px) rotate(610deg) scale(.82)` },
    ], {
      duration: reducedMotion ? 80 : Math.min(760, Math.max(430, Math.hypot(dx, dy) * 1.05)),
      easing: 'cubic-bezier(.22,.68,.24,1)',
      fill: 'forwards',
    });

    animation.onfinish = () => {
      projectile.remove();
      // Collision is checked against the photo-frame rectangle at impact time.
      const currentFrame = targetFrame.getBoundingClientRect();
      const currentArena = gameArena.getBoundingClientRect();
      const collisionRect = {
        left: currentFrame.left - currentArena.left,
        right: currentFrame.right - currentArena.left,
        top: currentFrame.top - currentArena.top,
        bottom: currentFrame.bottom - currentArena.top,
      };
      registerHit(landing, collisionRect);
    };
  }

  function hideAim() {
    aimGuide.style.display = 'none';
    dragGhost.classList.remove('is-visible');
  }

  function beginDrag(event, launcher) {
    if (event.button !== undefined && event.button !== 0) return;
    event.preventDefault();
    const rect = launcher.getBoundingClientRect();
    state.activePointer = {
      id: event.pointerId,
      launcher,
      startX: event.clientX,
      startY: event.clientY,
      moved: false,
    };
    dragGhost.classList.add('is-visible');
    dragGhost.style.left = `${event.clientX - 18}px`;
    dragGhost.style.top = `${event.clientY - 18}px`;
    launcher.setPointerCapture?.(event.pointerId);
    aimGuide.style.display = 'block';
    const arenaRect = gameArena.getBoundingClientRect();
    const startX = rect.left + rect.width / 2 - arenaRect.left;
    const startY = rect.top + rect.height / 2 - arenaRect.top;
    aimGuide.style.left = `${startX}px`;
    aimGuide.style.top = `${startY}px`;
    aimGuide.style.width = '0px';
  }

  function moveDrag(event) {
    const drag = state.activePointer;
    if (!drag || event.pointerId !== drag.id) return;
    const distance = Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY);
    if (distance > 7) drag.moved = true;
    dragGhost.style.left = `${event.clientX - 18}px`;
    dragGhost.style.top = `${event.clientY - 18}px`;

    const arenaRect = gameArena.getBoundingClientRect();
    const launcherRect = drag.launcher.getBoundingClientRect();
    const sx = launcherRect.left + launcherRect.width / 2 - arenaRect.left;
    const sy = launcherRect.top + launcherRect.height / 2 - arenaRect.top;
    const ex = event.clientX - arenaRect.left;
    const ey = event.clientY - arenaRect.top;
    const length = Math.hypot(ex - sx, ey - sy);
    aimGuide.style.width = `${length}px`;
    aimGuide.style.transform = `rotate(${Math.atan2(ey - sy, ex - sx)}rad)`;
  }

  function endDrag(event) {
    const drag = state.activePointer;
    if (!drag || event.pointerId !== drag.id) return;
    state.activePointer = null;
    hideAim();
    state.lastPointerLaunch = Date.now();
    if (drag.moved) {
      state.lastDragEnd = Date.now();
      throwTomato(drag.launcher, aimedPoint(event.clientX, event.clientY));
    } else {
      throwTomato(drag.launcher, randomAimPoint());
    }
  }

  function resetGame() {
    state.tomatoCount = 0;
    tomatoCount.textContent = '0';
    splatterLayer.replaceChildren();
    projectileLayer.replaceChildren();
    showMilestone('I’m ready to accept the consequences.');
  }

  // Navigation
  $('#openLetterButton').addEventListener('click', () => showScreen('letter'));
  $('#toRevealButton').addEventListener('click', () => showScreen('reveal'));
  $('#toGameButton').addEventListener('click', () => {
    requestPortraits();
    showScreen('game');
  });
  $$('[data-go]').forEach((button) => button.addEventListener('click', () => showScreen(button.dataset.go)));
  $$('[data-home-link]').forEach((link) => link.addEventListener('click', (event) => {
    event.preventDefault();
    showScreen('intro');
  }));

  // Sound is generated locally with Web Audio; no sound files or autoplay are used.
  soundToggle.addEventListener('click', () => setSoundEnabled(!state.soundEnabled));
  revealButton.addEventListener('click', startReveal);

  // Pointer events cover mouse, pen and touch. Only the tomato controls suppress
  // touch scrolling while a drag is active; the rest of the page scrolls normally.
  $$('.tomato-launcher').forEach((launcher) => {
    launcher.addEventListener('pointerdown', (event) => beginDrag(event, launcher));
    launcher.addEventListener('click', () => {
      // Pointer launches happen on pointerup. This click path is for keyboard activation.
      if (Date.now() - state.lastPointerLaunch < 500) return;
      throwTomato(launcher, randomAimPoint());
    });
  });
  document.addEventListener('pointermove', moveDrag, { passive: false });
  document.addEventListener('pointerup', endDrag);
  document.addEventListener('pointercancel', endDrag);
  $('#resetGameButton').addEventListener('click', resetGame);

  // Tap or click anywhere on the game screen to throw a tomato at that spot.
  // Buttons and links keep their own behaviour, so the tomato buttons never double-fire.
  function nearestLauncher(clientX) {
    return $$('.tomato-launcher').reduce((best, launcher) => {
      const rect = launcher.getBoundingClientRect();
      const distance = Math.abs(rect.left + rect.width / 2 - clientX);
      return !best || distance < best.distance ? { launcher, distance } : best;
    }, null)?.launcher;
  }

  document.addEventListener('click', (event) => {
    if (state.activeScreen !== 'game') return;
    if (event.target.closest('button, a')) return;
    if (Date.now() - state.lastDragEnd < 400) return;
    throwTomato(nearestLauncher(event.clientX), aimedPoint(event.clientX, event.clientY));
  });

  // The letter deliberately has no automatically inferred date or personal detail.
  setSoundEnabled(true);
  screens.forEach((screen) => {
    screen.setAttribute('aria-hidden', String(screen.id !== 'intro'));
  });
})();