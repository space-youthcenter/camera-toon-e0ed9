(function () {
  "use strict";

  var video = document.getElementById("cameraVideo");
  var canvas = document.getElementById("liveCanvas");
  var ctx = canvas.getContext("2d", { willReadFrequently: true, alpha: false }) || canvas.getContext("2d");
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

  var stream = null;
  var facingMode = "environment";
  var frameReady = false;
  var running = false;
  var animationId = 0;
  var resizeTimer = 0;
  var aiEnabled = false;
  var cameraDevices = [];
  var selectedDeviceId = "";
  var activeTrack = null;
  var nativeZoom = false;
  var digitalZoom = 1;
  var autoSelectedWide = false;
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
  flipButton.addEventListener("click", cycleCamera);
  zoomRange.addEventListener("input", applyZoom);
  shutterButton.addEventListener("click", capturePhoto);
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
    else if (running) animationId = requestAnimationFrame(renderLoop);
  });

  async function startCamera(deviceId) {
    if (!ctx || !resultCtx || !lowCtx || !capturedCtx || !cropCtx) {
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
      if (cameraScore(cameraDevices[i]) > 0) return cameraDevices[i];
    }
    return cameraDevices[0] || null;
  }

  function cycleCamera() {
    if (cameraDevices.length > 1) {
      var current = cameraDevices.findIndex(function (device) { return device.deviceId === selectedDeviceId; });
      var next = cameraDevices[(current + 1 + cameraDevices.length) % cameraDevices.length];
      selectedDeviceId = next.deviceId;
      facingMode = /front|user|전면/i.test(next.label || "") ? "user" : "environment";
      showToast((next.label || "다른 카메라") + "로 바꾸는 중…");
      startCamera(next.deviceId);
      return;
    }
    selectedDeviceId = "";
    facingMode = facingMode === "environment" ? "user" : "environment";
    startCamera();
  }

  function configureZoom() {
    nativeZoom = false;
    digitalZoom = 1;
    var capabilities = activeTrack && activeTrack.getCapabilities ? activeTrack.getCapabilities() : {};
    if (capabilities.zoom && typeof capabilities.zoom.min === "number") {
      nativeZoom = true;
      zoomRange.min = capabilities.zoom.min;
      zoomRange.max = capabilities.zoom.max;
      zoomRange.step = capabilities.zoom.step || .1;
      zoomRange.value = capabilities.zoom.min;
    } else {
      zoomRange.min = 1;
      zoomRange.max = 2.5;
      zoomRange.step = .1;
      zoomRange.value = 1;
    }
    updateZoomLabel();
  }

  function applyZoom() {
    var value = Number(zoomRange.value) || 1;
    if (nativeZoom && activeTrack && activeTrack.applyConstraints) {
      activeTrack.applyConstraints({ advanced: [{ zoom: value }] }).catch(function () {
        nativeZoom = false;
        digitalZoom = Math.max(1, value);
      });
    } else {
      digitalZoom = Math.max(1, value);
    }
    updateZoomLabel();
  }

  function updateZoomLabel() {
    zoomLabel.textContent = (Number(zoomRange.value) || 1).toFixed(1) + "×";
  }

  function resizeCanvas() {
    var ratio = Math.min(window.devicePixelRatio || 1, 2);
    var cssWidth = Math.max(1, document.documentElement.clientWidth || window.innerWidth);
    var cssHeight = Math.max(1, document.documentElement.clientHeight || window.innerHeight);
    canvas.width = Math.round(cssWidth * ratio);
    canvas.height = Math.round(cssHeight * ratio);
  }

  function scheduleResize(delay) {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () {
      resizeCanvas();
      if (running && video.readyState >= 2) drawScene(ctx, canvas.width, canvas.height);
    }, delay || 80);
  }

  function renderLoop(time) {
    if (!running) return;
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
    targetCtx.fillText("TOON!", 0, 0);
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
    return { x: (width - w) / 2, y: (height - h) * (landscape ? .42 : .46), w: w, h: h };
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
    if (!running || video.readyState < 2) return;
    shutterButton.disabled = true;
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
    var cropScale = Math.min(1, 1200 / Math.max(screen.w, screen.h));
    cropCanvas.width = Math.max(2, Math.round(screen.w * cropScale));
    cropCanvas.height = Math.max(2, Math.round(screen.h * cropScale));
    cropCtx.drawImage(capturedCanvas, screen.x, screen.y, screen.w, screen.h, 0, 0, cropCanvas.width, cropCanvas.height);

    showStatus("손그림으로 바꾸는 중…");
    setTimeout(function () {
      createResult(frame, screen);
    }, 30);
  }

  async function createResult(frame, screen) {
    var transformed;
    var aiFailed = false;
    if (aiEnabled) {
      try {
        transformed = await transformWithAI(cropCanvas);
      } catch (error) {
        aiEnabled = false;
        aiFailed = true;
        transformed = createCanvasFallback(cropCanvas);
      }
    } else {
      transformed = createCanvasFallback(cropCanvas);
    }

    resultCtx.drawImage(capturedCanvas, 0, 0, resultCanvas.width, resultCanvas.height);
    resultCtx.drawImage(transformed, screen.x, screen.y, screen.w, screen.h);
    drawPaperFrame(resultCtx, frame, screen, null, resultCanvas.width, resultCanvas.height, transformed);
    resultSheet.classList.add("open");
    resultSheet.setAttribute("aria-hidden", "false");
    hideStatus();
    shutterButton.disabled = false;
    if (aiFailed) showToast("AI 변환에 실패해서 기본 효과로 저장했어요.");
  }

  // 무료 모드가 기본입니다. 서버가 AI 키 설정을 명시적으로 알려줄 때만 사진 crop을 전송합니다.
  async function detectAIMode() {
    if (location.protocol === "file:") return;
    var controller = typeof AbortController !== "undefined" ? new AbortController() : null;
    var timer = setTimeout(function () { if (controller) controller.abort(); }, 2500);
    try {
      var response = await fetch("/api/ai-status", {
        method: "GET",
        cache: "no-store",
        signal: controller ? controller.signal : undefined
      });
      if (!response.ok) return;
      var payload = await response.json();
      aiEnabled = payload && payload.enabled === true;
    } catch (error) {
      aiEnabled = false;
    } finally {
      clearTimeout(timer);
    }
  }

  // 이미지 제공자를 바꿀 때 이 함수의 내부 구현만 교체하면 됩니다.
  async function transformWithAI(sourceCanvas) {
    var blob = await canvasToBlob(sourceCanvas, "image/jpeg", .9);
    var imageData = await blobToDataURL(blob);
    var response = await fetch("/api/transform", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image: imageData, width: sourceCanvas.width, height: sourceCanvas.height })
    });
    if (!response.ok) throw new Error("AI transform failed");
    var payload = await response.json();
    if (!payload.image) throw new Error("AI image missing");
    return loadImageToCanvas(payload.image, sourceCanvas.width, sourceCanvas.height);
  }

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

  function blobToDataURL(blob) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () { resolve(reader.result); };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  function loadImageToCanvas(dataURL, width, height) {
    return new Promise(function (resolve, reject) {
      var image = new Image();
      image.onload = function () {
        var output = document.createElement("canvas");
        output.width = width; output.height = height;
        drawImageCover(output.getContext("2d"), image, width, height);
        resolve(output);
      };
      image.onerror = reject;
      image.src = dataURL;
    });
  }

  function drawImageCover(context, image, width, height) {
    var crop = coverCrop(image.naturalWidth, image.naturalHeight, width, height);
    context.drawImage(image, crop.x, crop.y, crop.w, crop.h, 0, 0, width, height);
  }

  function closeResultSheet() {
    resultSheet.classList.remove("open");
    resultSheet.setAttribute("aria-hidden", "true");
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
  function showStatus(message) { status.textContent = message; status.classList.add("show"); }
  function hideStatus() { status.classList.remove("show"); }
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
