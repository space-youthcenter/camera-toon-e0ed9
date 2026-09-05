(function () {
  "use strict";

  var video = document.getElementById("cameraVideo");
  var canvas = document.getElementById("liveCanvas");
  var ctx = canvas.getContext("2d", { willReadFrequently: true, alpha: false }) || canvas.getContext("2d");
  var frozenCanvas = document.getElementById("frozenCanvas");
  var frozenCtx = frozenCanvas.getContext("2d", { alpha: false }) || frozenCanvas.getContext("2d");
  var stage = document.getElementById("stage");
  var resultCanvas = document.getElementById("resultCanvas");
  var resultCtx = resultCanvas.getContext("2d", { alpha: false }) || resultCanvas.getContext("2d");
  var frameImage = document.getElementById("frameImage");
  var permissionPanel = document.getElementById("permissionPanel");
  var permissionMessage = document.getElementById("permissionMessage");
  var startButton = document.getElementById("startButton");
  var cameraControls = document.getElementById("cameraControls");
  var shutterButton = document.getElementById("shutterButton");
  var flipButton = document.getElementById("flipButton");
  var resultSheet = document.getElementById("resultSheet");
  var closeResult = document.getElementById("closeResult");
  var retakeButton = document.getElementById("retakeButton");
  var saveButton = document.getElementById("saveButton");
  var status = document.getElementById("status");
  var toast = document.getElementById("toast");
  var zoomControl = document.getElementById("zoomControl");
  var zoomRange = document.getElementById("zoomRange");
  var zoomLabel = document.getElementById("zoomLabel");
  var modeButton = document.getElementById("modeButton");
  var modeName = document.getElementById("modeName");
  var connectionStatus = document.getElementById("connectionStatus");
  var resultMode = document.getElementById("resultMode");

  var stream = null;
  var facingMode = "environment";
  var frameReady = false;
  var running = false;
  var animationId = 0;
  var resizeTimer = 0;
  var aiEnabled = false;
  var aiCheckPending = true;
  var selectedMode = "ai";
  var cameraDevices = [];
  var selectedDeviceId = "";
  var activeTrack = null;
  var nativeZoom = false;
  var digitalZoom = 1;
  var autoSelectedWide = false;
  var processingCapture = false;
  var processingMessageTimers = [];
  var processingMessageInterval = 0;
  var AI_CROP_MAX_SIDE = 896;
  var lowCanvas = document.createElement("canvas");
  var lowCtx = lowCanvas.getContext("2d", { willReadFrequently: true }) || lowCanvas.getContext("2d");
  var capturedCanvas = document.createElement("canvas");
  var capturedCtx = capturedCanvas.getContext("2d", { alpha: false }) || capturedCanvas.getContext("2d");
  var cropCanvas = document.createElement("canvas");
  var cropCtx = cropCanvas.getContext("2d", { willReadFrequently: true }) || cropCanvas.getContext("2d");

  frameImage.onload = function () { frameReady = true; };
  frameImage.onerror = function () { frameReady = false; };
  detectAIMode();

  startButton.addEventListener("click", function () { startCamera(); });
  flipButton.addEventListener("click", toggleCameraFacing);
  zoomRange.addEventListener("input", applyZoom);
  shutterButton.addEventListener("click", capturePhoto);
  modeButton.addEventListener("click", toggleProcessingMode);
  closeResult.addEventListener("click", closeResultSheet);
  retakeButton.addEventListener("click", closeResultSheet);
  saveButton.addEventListener("click", savePhoto);
  window.addEventListener("resize", function () { scheduleResize(90); });
  window.addEventListener("orientationchange", function () { scheduleResize(220); });
  video.addEventListener("resize", function () { scheduleResize(60); });
  if (screen.orientation && screen.orientation.addEventListener) {
    screen.orientation.addEventListener("change", function () { scheduleResize(180); });
  }
  window.addEventListener("pagehide", stopCamera);
  document.addEventListener("visibilitychange", function () {
    if (document.hidden) cancelAnimationFrame(animationId);
    else if (running && !processingCapture) animationId = requestAnimationFrame(renderLoop);
  });

  async function startCamera(deviceId) {
    if (!ctx || !frozenCtx || !resultCtx || !lowCtx || !capturedCtx || !cropCtx) {
      showError("이 기기에서 카메라 화면을 준비하지 못했어요. Safari를 완전히 닫았다가 다시 열어 주세요.");
      return;
    }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      showError("이 브라우저에서는 카메라를 사용할 수 없어요. Safari 최신 버전을 이용해 주세요.");
      return;
    }
    stopCamera();
    showStatus("카메라를 깨우고 있어요…");
    var videoConstraints = {
      facingMode: { ideal: facingMode },
      width: { ideal: 1920 },
      height: { ideal: 1080 },
      aspectRatio: { ideal: 16 / 9 }
    };
    if (deviceId || selectedDeviceId) {
      videoConstraints.deviceId = { exact: deviceId || selectedDeviceId };
      delete videoConstraints.facingMode;
    }
    try {
      var mediaStream = await navigator.mediaDevices.getUserMedia({ audio: false, video: videoConstraints });
      stream = mediaStream;
      activeTrack = stream.getVideoTracks()[0] || null;
      var settings = activeTrack && activeTrack.getSettings ? activeTrack.getSettings() : {};
      if (settings.deviceId) selectedDeviceId = settings.deviceId;
      if (settings.facingMode === "user" || settings.facingMode === "environment") facingMode = settings.facingMode;
      video.srcObject = stream;
      video.setAttribute("playsinline", "");
      video.muted = true;
      await video.play();
      await refreshCameraDevices();
      if (!autoSelectedWide && facingMode === "environment") {
        autoSelectedWide = true;
        var preferred = findPreferredRearCamera();
        if (preferred && preferred.deviceId && preferred.deviceId !== selectedDeviceId) {
          selectedDeviceId = preferred.deviceId;
          await startCamera(preferred.deviceId);
          return;
        }
      }
      configureZoom();
      resizeCanvas();
      permissionPanel.classList.add("hidden");
      cameraControls.hidden = false;
      flipButton.hidden = false;
      updateFlipButton();
      zoomControl.hidden = false;
      hideStatus();
      running = true;
      animationId = requestAnimationFrame(renderLoop);
    } catch (error) {
      var message = error && (error.name === "NotAllowedError" || error.name === "SecurityError")
        ? "카메라 권한이 필요해요. Safari 설정에서 이 사이트의 카메라를 허용해 주세요."
        : "카메라를 시작하지 못했어요. 다른 앱이 카메라를 사용 중인지 확인해 주세요.";
      showError(message);
    }
  }

  function stopCamera() {
    running = false;
    cancelAnimationFrame(animationId);
    if (stream) {
      stream.getTracks().forEach(function (track) { track.stop(); });
      stream = null;
    }
    activeTrack = null;
  }

  async function refreshCameraDevices() {
    try {
      var devices = await navigator.mediaDevices.enumerateDevices();
      cameraDevices = devices.filter(function (device) { return device.kind === "videoinput"; });
      cameraDevices.sort(function (a, b) { return cameraScore(b) - cameraScore(a); });
    } catch (error) {
      cameraDevices = [];
    }
  }

  function cameraScore(device) {
    var label = (device.label || "").toLowerCase();
    var score = 0;
    if (/ultra|0\.5|초광각|울트라/.test(label)) score += 100;
    if (/wide|광각/.test(label) && !/tele|망원/.test(label)) score += 60;
    if (/back|rear|environment|후면/.test(label)) score += 40;
    if (/tele|망원/.test(label)) score -= 80;
    if (/front|user|전면/.test(label)) score -= 120;
    return score;
  }

  function findPreferredRearCamera() {
    for (var i = 0; i < cameraDevices.length; i++) {
      if (isRearCamera(cameraDevices[i]) && cameraScore(cameraDevices[i]) > 0) return cameraDevices[i];
    }
    for (var j = 0; j < cameraDevices.length; j++) {
      if (isRearCamera(cameraDevices[j])) return cameraDevices[j];
    }
    return null;
  }

  function findCameraForFacing(mode) {
    for (var i = 0; i < cameraDevices.length; i++) {
      if (mode === "user" ? isFrontCamera(cameraDevices[i]) : isRearCamera(cameraDevices[i])) return cameraDevices[i];
    }
    return null;
  }

  function isFrontCamera(device) {
    return /front|user|facetime|전면|셀피|selfie/i.test(device.label || "");
  }

  function isRearCamera(device) {
    var label = device.label || "";
    return /back|rear|environment|후면|초광각|광각|ultra|wide|tele|망원/i.test(label) && !isFrontCamera(device);
  }

  async function toggleCameraFacing() {
    if (processingCapture) return;
    facingMode = facingMode === "environment" ? "user" : "environment";
    selectedDeviceId = "";
    autoSelectedWide = facingMode === "user";
    updateFlipButton();
    showToast(facingMode === "user" ? "전면 카메라로 바꾸는 중…" : "후면 카메라로 바꾸는 중…");
    await refreshCameraDevices();
    var matchingDevice = findCameraForFacing(facingMode);
    startCamera(matchingDevice && matchingDevice.deviceId ? matchingDevice.deviceId : undefined);
  }

  function updateFlipButton() {
    var nextName = facingMode === "environment" ? "전면" : "후면";
    flipButton.setAttribute("aria-label", nextName + " 카메라로 전환");
    flipButton.title = nextName + " 카메라로 전환";
  }

  function configureZoom() {
    nativeZoom = false;
    digitalZoom = 1;
    var capabilities = activeTrack && activeTrack.getCapabilities ? activeTrack.getCapabilities() : {};
    if (capabilities.zoom && typeof capabilities.zoom.min === "number" &&
        typeof capabilities.zoom.max === "number" && capabilities.zoom.max >= 1 &&
        activeTrack && activeTrack.applyConstraints) {
      var nativeMin = Math.max(1, capabilities.zoom.min);
      var nativeMax = Math.min(4, capabilities.zoom.max);
      nativeZoom = true;
      zoomRange.min = nativeMin;
      zoomRange.max = Math.max(nativeMin, nativeMax);
      zoomRange.step = capabilities.zoom.step || .1;
      zoomRange.value = nativeMin;
      activeTrack.applyConstraints({ advanced: [{ zoom: nativeMin }] }).catch(function () {
        configureDigitalZoom(1);
      });
    } else {
      configureDigitalZoom(1);
    }
    updateZoomLabel();
  }

  function configureDigitalZoom(value) {
    nativeZoom = false;
    digitalZoom = Math.min(4, Math.max(1, Number(value) || 1));
    zoomRange.min = 1;
    zoomRange.max = 4;
    zoomRange.step = .1;
    zoomRange.value = digitalZoom;
    updateZoomLabel();
  }

  function applyZoom() {
    if (processingCapture) return;
    var value = Math.min(4, Math.max(1, Number(zoomRange.value) || 1));
    zoomRange.value = value;
    if (nativeZoom && activeTrack && activeTrack.applyConstraints) {
      activeTrack.applyConstraints({ advanced: [{ zoom: value }] }).catch(function () {
        configureDigitalZoom(value);
      });
    } else {
      digitalZoom = value;
    }
    updateZoomLabel();
  }

  function updateZoomLabel() {
    zoomLabel.textContent = Math.min(4, Math.max(1, Number(zoomRange.value) || 1)).toFixed(1) + "×";
  }

  function resizeCanvas() {
    var ratio = Math.min(window.devicePixelRatio || 1, 2);
    var cssWidth = Math.max(1, document.documentElement.clientWidth || window.innerWidth);
    var cssHeight = Math.max(1, document.documentElement.clientHeight || window.innerHeight);
    canvas.width = Math.round(cssWidth * ratio);
    canvas.height = Math.round(cssHeight * ratio);
    if (!processingCapture) {
      frozenCanvas.width = canvas.width;
      frozenCanvas.height = canvas.height;
    }
  }

  function scheduleResize(delay) {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () {
      resizeCanvas();
      if (running && !processingCapture && video.readyState >= 2) drawScene(ctx, canvas.width, canvas.height);
    }, delay || 80);
  }

  function renderLoop(time) {
    if (!running || processingCapture) return;
    drawScene(ctx, canvas.width, canvas.height);
    animationId = requestAnimationFrame(renderLoop);
  }

  function drawScene(targetCtx, width, height) {
    if (video.readyState < 2) return;
    var source = drawCurrentVideo(targetCtx, width, height);

    var frame = getFrameRect(width, height);
    var screen = getScreenRect(frame);
    drawPaperFrame(targetCtx, frame, screen, source, width, height, null);
  }

  function drawCurrentVideo(targetCtx, width, height) {
    var source = coverCrop(video.videoWidth, video.videoHeight, width, height);
    source = applyDigitalZoom(source);
    targetCtx.save();
    if (facingMode === "user") {
      targetCtx.translate(width, 0);
      targetCtx.scale(-1, 1);
    }
    targetCtx.drawImage(video, source.x, source.y, source.w, source.h, 0, 0, width, height);
    targetCtx.restore();
    return source;
  }

  function applyDigitalZoom(source) {
    if (nativeZoom || digitalZoom <= 1) return source;
    var w = source.w / digitalZoom;
    var h = source.h / digitalZoom;
    return { x: source.x + (source.w - w) / 2, y: source.y + (source.h - h) / 2, w: w, h: h };
  }

  function applyPencilSketch(pixels, width, height) {
    var data = pixels.data;
    var original = new Uint8ClampedArray(data);
    var count = width * height;
    var gray = new Float32Array(count);
    var soft = new Float32Array(count);
    var edges = new Float32Array(count);
    var x, y, i, p, row, prev, next, grain, lum, paper, hatch, ink, r, g, b;

    // 먼저 밝기만 분리하고 살짝 흐리게 만들어 잔머리·피부결 같은 작은 디테일을 줄입니다.
    for (p = 0; p < count; p++) {
      i = p * 4;
      gray[p] = original[i] * .299 + original[i + 1] * .587 + original[i + 2] * .114;
    }
    for (y = 1; y < height - 1; y++) {
      row = y * width;
      for (x = 1; x < width - 1; x++) {
        p = row + x;
        soft[p] = (gray[p - width - 1] + gray[p - width] * 2 + gray[p - width + 1] +
          gray[p - 1] * 2 + gray[p] * 4 + gray[p + 1] * 2 +
          gray[p + width - 1] + gray[p + width] * 2 + gray[p + width + 1]) / 16;
      }
    }

    // 흐린 밝기 영상에서 큰 형태의 윤곽만 찾아 펜선 지도를 만듭니다.
    for (y = 2; y < height - 2; y++) {
      row = y * width;
      for (x = 2; x < width - 2; x++) {
        p = row + x;
        var gx = -soft[p - width - 1] + soft[p - width + 1] - soft[p - 1] * 2 + soft[p + 1] * 2 - soft[p + width - 1] + soft[p + width + 1];
        var gy = -soft[p - width - 1] - soft[p - width] * 2 - soft[p - width + 1] + soft[p + width - 1] + soft[p + width] * 2 + soft[p + width + 1];
        edges[p] = Math.sqrt(gx * gx + gy * gy);
      }
    }

    for (y = 0; y < height; y++) {
      row = y * width;
      for (x = 0; x < width; x++) {
        p = row + x;
        i = p * 4;
        lum = original[i] * .299 + original[i + 1] * .587 + original[i + 2] * .114;
        prev = Math.max(0, p - 2);
        next = Math.min(count - 1, p + 2);
        var up = Math.max(0, p - width * 2);
        var down = Math.min(count - 1, p + width * 2);

        // 주변색을 섞고 넓은 색면으로 나눠 사진의 부드러운 그라데이션을 없앱니다.
        r = quantize((original[i] * 3 + original[prev * 4] + original[next * 4] + original[up * 4] + original[down * 4]) / 7 * 1.06 + 8, 44);
        g = quantize((original[i + 1] * 3 + original[prev * 4 + 1] + original[next * 4 + 1] + original[up * 4 + 1] + original[down * 4 + 1]) / 7 * 1.04 + 10, 44);
        b = quantize((original[i + 2] * 3 + original[prev * 4 + 2] + original[next * 4 + 2] + original[up * 4 + 2] + original[down * 4 + 2]) / 7 * .98 + 16, 44);
        grain = ((x * 19 + y * 37 + (x * y) % 23) % 31) - 15;
        paper = .18 + (((x * 7 + y * 13) % 31) < 5 ? .32 : 0);

        // 두 방향의 끊어진 해칭으로 색연필을 여러 번 문지른 결을 만듭니다.
        hatch = lum < 205 && ((x + y * 2 + (y % 5)) % 12 < 2) ? -17 : 0;
        if (lum < 145 && ((x * 2 - y + 10000 + (x % 7)) % 17 < 2)) hatch -= 15;
        if (((x * 3 + y * 5) % 53) === 0) hatch += 30;
        r = r * (1 - paper) + 250 * paper + grain * .42 + hatch;
        g = g * (1 - paper) + 247 * paper + grain * .36 + hatch;
        b = b * (1 - paper) + 235 * paper + grain * .3 + hatch * .8;

        // 이웃 윤곽을 조금씩 어긋나게 겹쳐 여러 번 그은 손펜 선을 만듭니다.
        var roughEdge = edges[p] || 0;
        if (x > 1 && y > 1) roughEdge = Math.max(roughEdge, edges[p - width - 1] * .78);
        if (((x * 11 + y * 7) % 19) < 9 && x < width - 2) roughEdge = Math.max(roughEdge, edges[p + 1] * .7);
        var threshold = 42 + ((x * 5 + y * 3) % 21);
        ink = roughEdge > threshold ? Math.min(.92, (roughEdge - threshold + 28) / 150) : 0;
        if (((x * 13 + y * 17) % 47) === 0) ink *= .35;
        data[i] = clamp(r * (1 - ink) + 28 * ink);
        data[i + 1] = clamp(g * (1 - ink) + 25 * ink);
        data[i + 2] = clamp(b * (1 - ink) + 23 * ink);
      }
    }
  }

  function drawPaperFrame(targetCtx, frame, screen, source, fullW, fullH, pencilRegion) {
    if (frameReady) {
      if (pencilRegion) targetCtx.drawImage(pencilRegion, screen.x, screen.y, screen.w, screen.h);
      targetCtx.drawImage(frameImage, frame.x, frame.y, frame.w, frame.h);
      return;
    }
    var line = Math.max(5, frame.w * .014);
    var x = frame.x, y = frame.y, w = frame.w, h = frame.h;
    var landscape = w / h > 1.42;
    targetCtx.save();
    targetCtx.lineJoin = "round";
    targetCtx.lineCap = "round";

    // 오려 붙인 종이처럼 살짝 어긋난 뒷면과 짙은 그림자.
    targetCtx.save();
    targetCtx.translate(w * .018, h * .035);
    paperBodyPath(targetCtx, x, y, w, h);
    targetCtx.fillStyle = "rgba(20,16,12,.52)";
    targetCtx.fill();
    targetCtx.restore();

    targetCtx.save();
    targetCtx.translate(-w * .012, h * .012);
    paperBodyPath(targetCtx, x, y, w, h);
    targetCtx.fillStyle = "#d7b971";
    targetCtx.strokeStyle = "#2f2924";
    targetCtx.lineWidth = line * .75;
    targetCtx.fill(); targetCtx.stroke();
    targetCtx.restore();

    paperBodyPath(targetCtx, x, y, w, h);
    targetCtx.fillStyle = "#fff4d2";
    targetCtx.strokeStyle = "#2f2924";
    targetCtx.lineWidth = line;
    targetCtx.fill(); targetCtx.stroke();

    // 종이 섬유와 잉크 점: 좌표가 고정되어 영상에서도 흔들리지 않습니다.
    targetCtx.fillStyle = "rgba(116,83,40,.12)";
    for (var dot = 0; dot < 72; dot++) {
      var dx = x + ((dot * 67) % 97) / 97 * w;
      var dy = y + ((dot * 43) % 89) / 89 * h;
      targetCtx.beginPath();
      targetCtx.arc(dx, dy, Math.max(1, w * (((dot % 3) + 1) * .0014)), 0, Math.PI * 2);
      targetCtx.fill();
    }
    targetCtx.strokeStyle = "rgba(135,101,55,.15)";
    targetCtx.lineWidth = Math.max(1, line * .15);
    for (var fiber = 0; fiber < 9; fiber++) {
      var fy = y + h * (.13 + fiber * .09);
      targetCtx.beginPath();
      targetCtx.moveTo(x + w * .05, fy);
      targetCtx.bezierCurveTo(x + w * .3, fy - h * .012, x + w * .65, fy + h * .015, x + w * .95, fy - h * .005);
      targetCtx.stroke();
    }

    // 위쪽 종이 셔터 받침과 눌러 보는 빨간 버튼.
    targetCtx.fillStyle = "#f0dcaa";
    targetCtx.strokeStyle = "#2f2924";
    targetCtx.lineWidth = line * .72;
    irregularTabPath(targetCtx, x + w * .12, y - h * .088, w * .25, h * .14);
    targetCtx.fill(); targetCtx.stroke();
    targetCtx.fillStyle = "#f47e58";
    roundedRect(targetCtx, x + w * .175, y - h * .125, w * .13, h * .085, line);
    targetCtx.fill(); targetCtx.stroke();
    targetCtx.beginPath();
    targetCtx.moveTo(x + w * .19, y - h * .095);
    targetCtx.lineTo(x + w * .29, y - h * .105);
    targetCtx.strokeStyle = "rgba(255,255,255,.8)";
    targetCtx.lineWidth = line * .25;
    targetCtx.stroke();

    // 중앙 화면 구멍: 미리보기에서는 원본, 촬영 결과에서만 색연필 그림을 표시합니다.
    targetCtx.save();
    roundedRect(targetCtx, screen.x, screen.y, screen.w, screen.h, w * .035);
    targetCtx.clip();
    if (pencilRegion) {
      targetCtx.drawImage(pencilRegion, screen.x, screen.y, screen.w, screen.h);
    } else {
      drawVideoRegion(targetCtx, source, screen, fullW, fullH);
    }
    targetCtx.restore();
    targetCtx.strokeStyle = "#342f2a";
    targetCtx.lineWidth = line * 1.15;
    roundedRect(targetCtx, screen.x, screen.y, screen.w, screen.h, w * .035);
    targetCtx.stroke();
    targetCtx.strokeStyle = "rgba(255,255,255,.72)";
    targetCtx.lineWidth = line * .25;
    roundedRect(targetCtx, screen.x + line * .8, screen.y + line * .8, screen.w - line * 1.6, screen.h - line * 1.6, w * .026);
    targetCtx.stroke();

    // 플래시: 접은 은색 종이에 노란 별빛을 붙인 모양.
    targetCtx.fillStyle = "#d9f0ea";
    targetCtx.strokeStyle = "#2f2924";
    targetCtx.lineWidth = line * .65;
    roundedRect(targetCtx, x + w * .69, y + h * .075, w * .18, h * .105, line * .8);
    targetCtx.fill(); targetCtx.stroke();
    targetCtx.strokeStyle = "#f1b829";
    targetCtx.lineWidth = line * .45;
    targetCtx.beginPath();
    targetCtx.moveTo(x + w * .715, y + h * .125); targetCtx.lineTo(x + w * .845, y + h * .125);
    targetCtx.moveTo(x + w * .78, y + h * .088); targetCtx.lineTo(x + w * .78, y + h * .163);
    targetCtx.stroke();

    // 장식 스티커와 작은 구멍들이 공작품 느낌을 더합니다.
    drawStar(targetCtx, x + w * .085, y + h * .18, w * .043, "#f5c84c", line * .42);
    drawHeart(targetCtx, x + w * (landscape ? .91 : .925), y + h * (landscape ? .67 : .82), w * .038, "#ef7890", line * .42);
    targetCtx.fillStyle = "#79c9bd";
    targetCtx.strokeStyle = "#2f2924";
    targetCtx.lineWidth = line * .55;
    targetCtx.beginPath();
    targetCtx.arc(x + w * (landscape ? .91 : .095), y + h * (landscape ? .82 : .89), w * .027, 0, Math.PI * 2);
    targetCtx.fill(); targetCtx.stroke();

    // MENU / OK 종이 버튼과 손으로 쓴 라벨.
    targetCtx.fillStyle = "#fffdf2";
    targetCtx.strokeStyle = "#342f2a";
    targetCtx.lineWidth = line * .48;
    if (landscape) {
      roundedRect(targetCtx, x + w * .84, y + h * .34, w * .105, h * .105, line);
      targetCtx.fill(); targetCtx.stroke();
      targetCtx.beginPath();
      targetCtx.arc(x + w * .892, y + h * .54, w * .043, 0, Math.PI * 2);
      targetCtx.fill(); targetCtx.stroke();
      targetCtx.fillStyle = "#342f2a";
      targetCtx.textAlign = "center"; targetCtx.textBaseline = "middle";
      targetCtx.font = "900 " + Math.round(w * .025) + "px Arial Rounded MT Bold, Arial";
      targetCtx.fillText("MENU", x + w * .892, y + h * .392);
      targetCtx.fillText("OK", x + w * .892, y + h * .54);
    } else {
      roundedRect(targetCtx, x + w * .18, y + h * .875, w * .19, h * .07, line);
      targetCtx.fill(); targetCtx.stroke();
      targetCtx.beginPath();
      targetCtx.arc(x + w * .77, y + h * .91, w * .038, 0, Math.PI * 2);
      targetCtx.fill(); targetCtx.stroke();
      targetCtx.fillStyle = "#342f2a";
      targetCtx.textAlign = "center"; targetCtx.textBaseline = "middle";
      targetCtx.font = "900 " + Math.round(w * .03) + "px Arial Rounded MT Bold, Arial";
      targetCtx.fillText("MENU", x + w * .275, y + h * .91);
      targetCtx.fillText("OK", x + w * .77, y + h * .91);
    }

    targetCtx.save();
    targetCtx.translate(x + w * (landscape ? .89 : .52), y + h * .91);
    targetCtx.rotate(-.025);
    targetCtx.fillStyle = "rgba(244,126,88,.62)";
    targetCtx.fillRect(-w * (landscape ? .07 : .11), -h * .03, w * (landscape ? .14 : .22), h * .06);
    targetCtx.fillStyle = "#342f2a";
    targetCtx.textAlign = "center";
    targetCtx.textBaseline = "middle";
    targetCtx.font = "900 " + Math.round(w * (landscape ? .018 : .025)) + "px Arial Rounded MT Bold, Arial";
    targetCtx.fillText("CAMERA", 0, 0);
    targetCtx.restore();
    targetCtx.restore();
  }

  function drawVideoRegion(targetCtx, source, screen, fullW, fullH) {
    var sx = source.x + screen.x / fullW * source.w;
    var sy = source.y + screen.y / fullH * source.h;
    var sw = screen.w / fullW * source.w;
    var sh = screen.h / fullH * source.h;
    targetCtx.save();
    if (facingMode === "user") {
      targetCtx.translate(screen.x * 2 + screen.w, 0);
      targetCtx.scale(-1, 1);
    }
    targetCtx.drawImage(video, sx, sy, sw, sh, screen.x, screen.y, screen.w, screen.h);
    targetCtx.restore();
  }

  function paperBodyPath(context, x, y, w, h) {
    context.beginPath();
    context.moveTo(x + w * .055, y + h * .035);
    context.quadraticCurveTo(x + w * .015, y + h * .04, x + w * .018, y + h * .12);
    context.lineTo(x + w * .027, y + h * .87);
    context.quadraticCurveTo(x + w * .03, y + h * .97, x + w * .12, y + h * .965);
    context.lineTo(x + w * .89, y + h * .978);
    context.quadraticCurveTo(x + w * .975, y + h * .97, x + w * .97, y + h * .87);
    context.lineTo(x + w * .983, y + h * .13);
    context.quadraticCurveTo(x + w * .98, y + h * .045, x + w * .91, y + h * .04);
    context.lineTo(x + w * .61, y + h * .025);
    context.quadraticCurveTo(x + w * .56, y - h * .035, x + w * .48, y + h * .005);
    context.lineTo(x + w * .055, y + h * .035);
    context.closePath();
  }

  function irregularTabPath(context, x, y, w, h) {
    context.beginPath();
    context.moveTo(x + w * .08, y + h);
    context.lineTo(x + w * .02, y + h * .22);
    context.quadraticCurveTo(x + w * .04, 0 + y, x + w * .2, y + h * .04);
    context.lineTo(x + w * .84, y + h * .01);
    context.quadraticCurveTo(x + w, y + h * .04, x + w * .98, y + h * .24);
    context.lineTo(x + w * .94, y + h);
    context.closePath();
  }

  function drawStar(context, cx, cy, radius, color, strokeWidth) {
    context.save(); context.beginPath();
    for (var point = 0; point < 10; point++) {
      var angle = -Math.PI / 2 + point * Math.PI / 5;
      var r = point % 2 ? radius * .46 : radius;
      var px = cx + Math.cos(angle) * r, py = cy + Math.sin(angle) * r;
      if (!point) context.moveTo(px, py); else context.lineTo(px, py);
    }
    context.closePath(); context.fillStyle = color; context.strokeStyle = "#2f2924"; context.lineWidth = strokeWidth; context.fill(); context.stroke(); context.restore();
  }

  function drawHeart(context, cx, cy, size, color, strokeWidth) {
    context.save(); context.beginPath();
    context.moveTo(cx, cy + size * .8);
    context.bezierCurveTo(cx - size * 1.2, cy + size * .05, cx - size * .9, cy - size * .75, cx, cy - size * .18);
    context.bezierCurveTo(cx + size * .9, cy - size * .75, cx + size * 1.2, cy + size * .05, cx, cy + size * .8);
    context.closePath(); context.fillStyle = color; context.strokeStyle = "#2f2924"; context.lineWidth = strokeWidth; context.fill(); context.stroke(); context.restore();
  }

  function getFrameRect(width, height) {
    var landscape = width > height;
    var maxW = width * (landscape ? .88 : .92);
    var maxH = height * (landscape ? .76 : .68);
    var fallbackRatio = landscape ? 1.68 : 1.08;
    var ratio = frameReady && frameImage.naturalWidth ? frameImage.naturalWidth / frameImage.naturalHeight : fallbackRatio;
    var w = maxW, h = w / ratio;
    if (h > maxH) { h = maxH; w = h * ratio; }
    var y = (height - h) * (landscape ? .42 : .46);
    if (landscape) y = Math.max(y, h * .15);
    return { x: (width - w) / 2, y: y, w: w, h: h };
  }

  function getScreenRect(frame) {
    var landscape = frame.w / frame.h > 1.42;
    return {
      x: Math.round(frame.x + frame.w * .075),
      y: Math.round(frame.y + frame.h * (landscape ? .16 : .145)),
      w: Math.round(frame.w * (landscape ? .72 : .85)),
      h: Math.round(frame.h * (landscape ? .66 : .70))
    };
  }

  function capturePhoto() {
    if (!running || processingCapture || video.readyState < 2) return;
    var timing = { captureStarted: nowMs() };
    processingCapture = true;
    setCaptureControlsDisabled(true);
    cancelAnimationFrame(animationId);
    var maxSide = 1800;
    // 카메라 센서의 고정 방향이 아니라 현재 보이는 캔버스 비율로 결과를 만듭니다.
    var scale = Math.min(1, maxSide / Math.max(canvas.width, canvas.height));
    resultCanvas.width = Math.max(2, Math.round(canvas.width * scale));
    resultCanvas.height = Math.max(2, Math.round(canvas.height * scale));
    capturedCanvas.width = resultCanvas.width;
    capturedCanvas.height = resultCanvas.height;
    drawCurrentVideo(capturedCtx, capturedCanvas.width, capturedCanvas.height);

    var frame = getFrameRect(resultCanvas.width, resultCanvas.height);
    var screen = getScreenRect(frame);
    var cropScale = Math.min(1, AI_CROP_MAX_SIDE / Math.max(screen.w, screen.h));
    cropCanvas.width = Math.max(2, Math.round(screen.w * cropScale));
    cropCanvas.height = Math.max(2, Math.round(screen.h * cropScale));
    cropCtx.drawImage(capturedCanvas, screen.x, screen.y, screen.w, screen.h, 0, 0, cropCanvas.width, cropCanvas.height);
    timing.cropReady = nowMs();
    timing.cropWidth = cropCanvas.width;
    timing.cropHeight = cropCanvas.height;
    console.info("[Camera Toon timing] 촬영 → crop", Math.round(timing.cropReady - timing.captureStarted) + "ms", cropCanvas.width + "x" + cropCanvas.height);

    // 셔터 순간 확정된 이 한 장만 화면에 고정하고 API crop에도 재사용합니다.
    frozenCanvas.width = canvas.width;
    frozenCanvas.height = canvas.height;
    frozenCtx.drawImage(capturedCanvas, 0, 0, frozenCanvas.width, frozenCanvas.height);
    var frozenFrame = getFrameRect(frozenCanvas.width, frozenCanvas.height);
    var frozenScreen = getScreenRect(frozenFrame);
    drawPaperFrame(frozenCtx, frozenFrame, frozenScreen, null, frozenCanvas.width, frozenCanvas.height, cropCanvas);
    stage.classList.add("is-frozen");

    showProcessingStatus(selectedMode === "ai" && aiEnabled);
    setTimeout(function () {
      createResult(frame, screen, timing);
    }, 30);
  }

  async function createResult(frame, screen, timing) {
    var transformed;
    var aiFailed = false;
    var usedAI = false;
    try {
      if (selectedMode === "ai" && aiEnabled) {
        try {
          transformed = await transformWithAI(cropCanvas, timing);
          usedAI = true;
        } catch (error) {
          aiEnabled = false;
          selectedMode = "basic";
          aiFailed = true;
          updateModeDisplay();
          transformed = createCanvasFallback(cropCanvas);
        }
      } else {
        transformed = createCanvasFallback(cropCanvas);
      }

      resultCtx.drawImage(capturedCanvas, 0, 0, resultCanvas.width, resultCanvas.height);
      drawPaperFrame(resultCtx, frame, screen, null, resultCanvas.width, resultCanvas.height, transformed);
      resultMode.textContent = usedAI ? "AI 손그림 변환 완료" : (aiFailed ? "기본 손그림 효과로 완성했어요." : "기본 손그림 효과로 변환했어요");
      timing.compositeComplete = nowMs();
      logTimingSummary(timing, usedAI);
      showProcessingComplete(aiFailed ? "기본 손그림 효과로 완성했어요." : "완성!");
      await waitForPaint();
      resultSheet.classList.add("open");
      resultSheet.setAttribute("aria-hidden", "false");
      if (aiFailed) showToast("AI 변환에 실패해서 기본 효과로 저장했어요.");
    } catch (error) {
      timing.compositeComplete = nowMs();
      logTimingSummary(timing, false);
      showToast("결과를 만들지 못했어요. 다시 촬영해 주세요.");
      stage.classList.remove("is-frozen");
      if (running) animationId = requestAnimationFrame(renderLoop);
    } finally {
      hideStatus();
      processingCapture = false;
      setCaptureControlsDisabled(false);
    }
  }

  // 무료 모드가 기본입니다. 서버가 AI 키 설정을 명시적으로 알려줄 때만 사진 crop을 전송합니다.
  async function detectAIMode() {
    aiCheckPending = true;
    updateModeDisplay();
    if (location.protocol === "file:") {
      finishAICheck(false);
      return;
    }
    var controller = typeof AbortController !== "undefined" ? new AbortController() : null;
    var timer = setTimeout(function () { if (controller) controller.abort(); }, 2500);
    try {
      var response = await fetch("/api/ai-status", {
        method: "GET",
        cache: "no-store",
        signal: controller ? controller.signal : undefined
      });
      if (!response.ok) {
        finishAICheck(false);
        return;
      }
      var payload = await response.json();
      finishAICheck(payload && payload.enabled === true);
    } catch (error) {
      finishAICheck(false);
    } finally {
      clearTimeout(timer);
    }
  }

  function finishAICheck(enabled) {
    aiEnabled = enabled === true;
    aiCheckPending = false;
    if (!aiEnabled) selectedMode = "basic";
    updateModeDisplay();
  }

  function toggleProcessingMode() {
    if (processingCapture || aiCheckPending) return;
    if (selectedMode === "ai") {
      selectedMode = "basic";
      updateModeDisplay();
      showToast("기본 모드로 촬영해요.");
      return;
    }
    if (!aiEnabled) {
      showToast("이 환경에서는 AI를 사용할 수 없어 기본 모드로 촬영해요.");
      return;
    }
    selectedMode = "ai";
    updateModeDisplay();
    showToast("AI 손그림 모드로 촬영해요.");
  }

  function updateModeDisplay() {
    modeButton.classList.toggle("checking", aiCheckPending);
    modeButton.classList.toggle("basic", !aiCheckPending && selectedMode === "basic");
    if (aiCheckPending) {
      modeName.textContent = "AI 손그림";
      connectionStatus.textContent = "AI 확인 중...";
      modeButton.setAttribute("aria-label", "AI 확인 중, 촬영 처리 모드 변경");
      return;
    }
    if (selectedMode === "ai" && aiEnabled) {
      modeName.textContent = "AI 손그림";
      connectionStatus.textContent = "AI 연결됨";
      modeButton.setAttribute("aria-label", "현재 AI 손그림 모드, 기본 모드로 변경");
      return;
    }
    modeName.textContent = "기본 모드";
    connectionStatus.textContent = aiEnabled ? "AI 연결됨 · 전환 가능" : "기본 모드";
    modeButton.setAttribute("aria-label", aiEnabled ? "현재 기본 모드, AI 손그림 모드로 변경" : "현재 기본 모드, AI 사용 불가");
  }

  // 이미지 제공자를 바꿀 때 이 함수의 내부 구현만 교체하면 됩니다.
  async function transformWithAI(sourceCanvas, timing) {
    var blob = await canvasToBlob(sourceCanvas, "image/jpeg", .86);
    timing.apiStarted = nowMs();
    var endpoint = "/api/transform?width=" + sourceCanvas.width + "&height=" + sourceCanvas.height;
    var response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "image/jpeg" },
      body: blob
    });
    var payload = await response.json();
    timing.apiCompleted = nowMs();
    timing.serverOpenAIMs = payload && payload.timing ? payload.timing.openaiMs : null;
    console.info("[Camera Toon timing] /api/transform 요청 → 응답", Math.round(timing.apiCompleted - timing.apiStarted) + "ms", timing.serverOpenAIMs == null ? "" : "OpenAI " + timing.serverOpenAIMs + "ms");
    if (!response.ok) throw new Error("AI transform failed");
    if (!payload.image) throw new Error("AI image missing");
    return loadImage(payload.image);
  }

  function logTimingSummary(timing, usedAI) {
    var compositeStart = timing.apiCompleted || timing.cropReady;
    var summary = {
      mode: usedAI ? "ai" : "basic",
      crop: timing.cropWidth + "x" + timing.cropHeight,
      captureToCropMs: Math.round(timing.cropReady - timing.captureStarted),
      apiRequestMs: timing.apiStarted && timing.apiCompleted ? Math.round(timing.apiCompleted - timing.apiStarted) : 0,
      serverOpenAIMs: timing.serverOpenAIMs == null ? null : Math.round(timing.serverOpenAIMs),
      responseToCompositeMs: Math.round(timing.compositeComplete - compositeStart),
      totalMs: Math.round(timing.compositeComplete - timing.captureStarted)
    };
    console.info("[Camera Toon timing] OpenAI 응답 → 최종 합성", summary.responseToCompositeMs + "ms");
    console.info("[Camera Toon timing] 전체 변환", summary.totalMs + "ms", summary);
  }

  function nowMs() { return typeof performance !== "undefined" && performance.now ? performance.now() : Date.now(); }

  function createCanvasFallback(sourceCanvas) {
    lowCanvas.width = sourceCanvas.width;
    lowCanvas.height = sourceCanvas.height;
    lowCtx.drawImage(sourceCanvas, 0, 0);
    var pixels = lowCtx.getImageData(0, 0, lowCanvas.width, lowCanvas.height);
    applyPencilSketch(pixels, lowCanvas.width, lowCanvas.height);
    lowCtx.putImageData(pixels, 0, 0);
    addPencilTexture(lowCtx, lowCanvas.width, lowCanvas.height);
    return lowCanvas;
  }

  function addPencilTexture(context, width, height) {
    var unit = Math.max(1, Math.round(Math.min(width, height) / 520));
    context.save();

    // 종이 섬유와 밝은 빈틈을 얹어 색이 디지털 페인트처럼 꽉 차 보이지 않게 합니다.
    context.globalCompositeOperation = "screen";
    context.strokeStyle = "rgba(255,250,232,.2)";
    context.lineWidth = unit;
    for (var fiber = -height; fiber < width + height; fiber += unit * 13) {
      context.beginPath();
      context.moveTo(fiber, 0);
      context.lineTo(fiber - height * .42, height);
      context.stroke();
    }

    // 짧고 끊어진 두 방향의 선으로 색연필 해칭을 강화합니다.
    context.globalCompositeOperation = "multiply";
    context.lineCap = "round";
    for (var y = unit * 4; y < height; y += unit * 9) {
      for (var x = (y * 7) % (unit * 19); x < width; x += unit * 23) {
        var tone = ((x * 17 + y * 11) % 29) / 29;
        context.strokeStyle = "rgba(72,55,43," + (.035 + tone * .055) + ")";
        context.lineWidth = unit * (.6 + tone * .55);
        context.beginPath();
        context.moveTo(x, y + ((x + y) % (unit * 3)));
        context.lineTo(Math.min(width, x + unit * (7 + tone * 6)), Math.max(0, y - unit * (3 + tone * 3)));
        context.stroke();
      }
    }

    // 작은 종이 알갱이는 고정 좌표를 사용해 결과가 매번 안정적으로 보이게 합니다.
    context.globalCompositeOperation = "source-over";
    for (var dot = 0; dot < Math.min(2600, Math.round(width * height / 520)); dot++) {
      var px = (dot * 97 + dot * dot * 13) % width;
      var py = (dot * 53 + dot * dot * 7) % height;
      var light = dot % 3 === 0;
      context.fillStyle = light ? "rgba(255,252,238,.16)" : "rgba(63,47,37,.075)";
      context.fillRect(px, py, unit, unit);
    }
    context.restore();
  }

  function canvasToBlob(sourceCanvas, type, quality) {
    return new Promise(function (resolve, reject) {
      sourceCanvas.toBlob(function (blob) { blob ? resolve(blob) : reject(new Error("Canvas encoding failed")); }, type, quality);
    });
  }

  function loadImage(dataURL) {
    return new Promise(function (resolve, reject) {
      var image = new Image();
      image.onload = function () { resolve(image); };
      image.onerror = reject;
      image.src = dataURL;
    });
  }

  function closeResultSheet() {
    resultSheet.classList.remove("open");
    resultSheet.setAttribute("aria-hidden", "true");
    stage.classList.remove("is-frozen");
    if (running && !processingCapture) {
      cancelAnimationFrame(animationId);
      animationId = requestAnimationFrame(renderLoop);
    }
  }

  function savePhoto() {
    resultCanvas.toBlob(function (blob) {
      if (!blob) { showToast("사진을 저장하지 못했어요."); return; }
      var url = URL.createObjectURL(blob);
      var link = document.createElement("a");
      link.href = url;
      link.download = "camera-toon-" + Date.now() + ".png";
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
      showToast("사진을 저장했어요!");
    }, "image/png");
  }

  function coverCrop(sourceW, sourceH, targetW, targetH) {
    var sourceRatio = sourceW / sourceH;
    var targetRatio = targetW / targetH;
    if (sourceRatio > targetRatio) {
      var w = sourceH * targetRatio;
      return { x: (sourceW - w) / 2, y: 0, w: w, h: sourceH };
    }
    var h = sourceW / targetRatio;
    return { x: 0, y: (sourceH - h) / 2, w: sourceW, h: h };
  }

  function roundedRect(context, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    context.beginPath(); context.moveTo(x + r, y);
    context.arcTo(x + w, y, x + w, y + h, r); context.arcTo(x + w, y + h, x, y + h, r);
    context.arcTo(x, y + h, x, y, r); context.arcTo(x, y, x + w, y, r); context.closePath();
  }

  function quantize(value, step) { return clamp(Math.round(clamp(value) / step) * step); }
  function clamp(value) { return Math.max(0, Math.min(255, value)); }
  function setCaptureControlsDisabled(disabled) {
    shutterButton.disabled = disabled;
    flipButton.disabled = disabled;
    zoomRange.disabled = disabled;
    modeButton.disabled = disabled;
  }
  function showStatus(message) { clearProcessingSequence(); status.classList.remove("processing"); status.textContent = message; status.classList.add("show"); }
  function showProcessingStatus(useAI) {
    clearProcessingSequence();
    status.classList.add("processing", "show");
    status.dataset.phase = useAI ? "captured" : "basic";
    status.innerHTML = '<div class="toon-progress"><svg viewBox="0 0 82 50" aria-hidden="true"><path class="toon-paper" d="M5 7 Q7 3 13 5 L65 4 Q70 5 68 11 L70 41 Q68 46 62 44 L11 46 Q5 44 7 38 Z"/><path class="toon-color" d="M17 32 Q28 27 39 32 T61 30"/><path class="toon-line" d="M15 34 Q22 16 34 25 Q43 8 57 27 Q62 32 64 35"/><g class="toon-pencil"><path class="toon-pencil-body" d="M42 10 L68 30 L62 37 L36 16 Z"/><path class="toon-pencil-tip" d="M36 16 L30 10 L42 10 Z"/></g><circle class="toon-spark" cx="72" cy="10" r="3"/><circle class="toon-spark second" cx="77" cy="20" r="2.5"/></svg><div class="toon-progress-copy"><strong id="processingMessage">' + (useAI ? '사진 촬영 완료!' : '손그림 만드는 중...') + '</strong><small>사진 촬영은 완료됐어요.</small></div></div>';
    if (!useAI) return;
    queueProcessingMessage(1200, "검은 펜으로 윤곽선을 그리고 있어요...", "outline");
    queueProcessingMessage(4300, "색연필로 슥슥 칠하는 중...", "color");
    queueProcessingMessage(7600, "조금만 기다리면 완성!", "finishing");
    queueProcessingMessage(10600, "색연필로 마무리하는 중...", "color");
    processingMessageTimers.push(setTimeout(function () {
      var alternate = false;
      processingMessageInterval = setInterval(function () {
        alternate = !alternate;
        updateProcessingMessage(alternate ? "조금만 기다리면 완성!" : "색연필로 마무리하는 중...", alternate ? "finishing" : "color");
      }, 3000);
    }, 13600));
  }
  function queueProcessingMessage(delay, message, phase) {
    processingMessageTimers.push(setTimeout(function () { updateProcessingMessage(message, phase); }, delay));
  }
  function updateProcessingMessage(message, phase) {
    var messageNode = document.getElementById("processingMessage");
    if (messageNode) messageNode.textContent = message;
    status.dataset.phase = phase;
  }
  function showProcessingComplete(message) {
    clearProcessingSequence();
    updateProcessingMessage(message, "complete");
  }
  function clearProcessingSequence() {
    processingMessageTimers.forEach(clearTimeout);
    processingMessageTimers = [];
    clearInterval(processingMessageInterval);
    processingMessageInterval = 0;
  }
  function waitForPaint() {
    return new Promise(function (resolve) { requestAnimationFrame(resolve); });
  }
  function hideStatus() { clearProcessingSequence(); status.classList.remove("show", "processing"); delete status.dataset.phase; }
  function showError(message) { hideStatus(); permissionMessage.textContent = message; startButton.textContent = "다시 시도"; permissionPanel.classList.remove("hidden"); }
  var toastTimer;
  function showToast(message) { toast.textContent = message; toast.classList.add("show"); clearTimeout(toastTimer); toastTimer = setTimeout(function () { toast.classList.remove("show"); }, 2500); }

  if (location.protocol !== "https:" && location.hostname !== "localhost") {
    showError("카메라는 안전한 HTTPS 주소에서만 사용할 수 있어요.");
  } else {
    // 앱을 열면 즉시 권한을 요청합니다. Safari가 재생을 막는 경우 시작 버튼으로 다시 시도합니다.
    setTimeout(startCamera, 120);
  }
})();
