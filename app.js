/**
 * 微醺酒局 · 绯夜秘酒馆大礼包 核心交互逻辑
 * 高定鎏金星盘 Canvas 渲染 + 2:3 塔罗秘牌 + 暗盅皮摇盅
 */
(function () {
  const DATA = window.PARTY_DATA;
  const SFX = window.SoundEngine;

  const STORAGE_KEY = "tipsy_party_pack_v2";

  const AVATAR_COLORS = [
    "linear-gradient(135deg,#fff0d2,#d9a85c)",
    "linear-gradient(135deg,#ffc8d8,#c93b63)",
    "linear-gradient(135deg,#f5d8b8,#b57c4a)",
    "linear-gradient(135deg,#ffd6e6,#a82c51)",
    "linear-gradient(135deg,#f8e5c8,#c79448)",
    "linear-gradient(135deg,#f2c6d4,#912647)",
  ];

  const CN_NUMS = ["零", "壹", "贰", "叁", "肆", "伍", "陆", "柒", "捌", "玖", "拾", "拾壹", "拾贰"];

  // ==================== STATE ====================
  const state = loadState();
  let currentTab = "wheel";
  let wheelAngle = 0;
  let wheelSpinning = false;
  let lastPickedPlayer = null;

  // King Game state
  let kingRound = {
    count: Math.max(3, Math.min(12, state.players.length)),
    roles: [],
    currentIndex: 0,
    cardFlipped: false,
    kingRevealed: false,
    activeTargets: [],
  };

  // Cards state
  let cardMode = "dilemma";
  let dilemmaIndex = 0;
  let dilemmaVotes = { a: 0, b: 0 };
  let tdHistory = [];
  let tdCursor = -1;
  let tdTimerId = null;
  let tdSeconds = 30;
  let customCardType = "truth";

  // Dice state
  let diceValues = [1, 3, 5, 2, 6];
  let dicePeekMode = true;
  let diceOpened = false;
  let diceRolling = false;

  let toastTimer = null;

  function loadState() {
    const fallback = {
      level: "mild",
      sound: true,
      players: [...DATA.defaultPlayers],
      wheelMode: "players",
      drinkWheel: [...DATA.defaultDrinkWheel],
      customTruths: [],
      customDares: [],
    };
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return fallback;
      const parsed = JSON.parse(raw);
      return {
        ...fallback,
        ...parsed,
        players: Array.isArray(parsed.players) && parsed.players.length >= 2 ? parsed.players : fallback.players,
        drinkWheel:
          Array.isArray(parsed.drinkWheel) && parsed.drinkWheel.length >= 2
            ? parsed.drinkWheel
            : fallback.drinkWheel,
        customTruths: Array.isArray(parsed.customTruths) ? parsed.customTruths : [],
        customDares: Array.isArray(parsed.customDares) ? parsed.customDares : [],
      };
    } catch (_) {
      return fallback;
    }
  }

  function saveState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (_) {}
  }

  // ==================== HELPERS ====================
  const $ = (id) => document.getElementById(id);

  function showToast(msg) {
    const el = $("toast");
    el.textContent = msg;
    el.classList.remove("hidden");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.add("hidden"), 2200);
  }

  function shuffle(arr) {
    const copy = [...arr];
    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  }

  function pickRandom(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
  }

  function pickTwoPlayers(forcedA) {
    const pool = state.players.length >= 2 ? state.players : ["宾客甲", "宾客乙"];
    const a = forcedA && pool.includes(forcedA) ? forcedA : pickRandom(pool);
    const others = pool.filter((p) => p !== a);
    const b = others.length ? pickRandom(others) : "邻座好友";
    return [a, b];
  }

  function fillPlaceholders(text, forcedA) {
    const [a, b] = pickTwoPlayers(forcedA);
    return {
      text: text.replace(/\{A\}/g, `「${a}」`).replace(/\{B\}/g, `「${b}」`),
      playerA: a,
      playerB: b,
    };
  }

  function detectInAppBrowser() {
    const ua = navigator.userAgent || "";
    if (/MicroMessenger|QQ\/|Weibo|XHS|RedBook|AliApp/i.test(ua)) {
      $("browserTip").classList.remove("hidden");
    }
  }

  // ==================== NAVIGATION & GLOBAL BAR ====================
  function syncGlobalUI() {
    SFX.enabled = state.sound;
    $("soundIconOn").classList.toggle("hidden", !state.sound);
    $("soundIconOff").classList.toggle("hidden", state.sound);
    $("playerCountLabel").textContent = `${state.players.length}人入座`;

    document.querySelectorAll(".intensity-chip").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.level === state.level);
    });

    const charmEl = $("tdWaterCharm");
    if (charmEl && DATA.levelCharms[state.level]) {
      charmEl.src = DATA.levelCharms[state.level];
    }

    renderPlayersModalList();
    renderKingSetupPreview();
    drawWheel();
  }

  function switchTab(target) {
    currentTab = target;
    SFX.click();
    document.querySelectorAll(".view").forEach((v) => v.classList.remove("active"));
    $(`view-${target}`).classList.add("active");
    document.querySelectorAll(".nav-item").forEach((n) => {
      n.classList.toggle("active", n.dataset.target === target);
    });
    if (target === "wheel") {
      drawWheel();
    } else if (target === "cards") {
      if (cardMode === "dilemma") renderDilemma();
      else if (tdCursor === -1) drawNextTD();
    }
  }

  // ==================== 1. GILDED ASTROLABE WHEEL MODULE ====================
  function getWheelItems() {
    if (state.wheelMode === "players") {
      return state.players.length >= 2 ? state.players : ["宾客甲", "宾客乙"];
    }
    return state.drinkWheel;
  }

  function drawWheel() {
    const canvas = $("wheelCanvas");
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const size = canvas.width;
    const cx = size / 2;
    const cy = size / 2;
    const outerRadius = size / 2 - 6;
    const innerRimRadius = outerRadius - 22;
    const items = getWheelItems();
    const count = items.length;
    const arc = (Math.PI * 2) / count;

    ctx.clearRect(0, 0, size, size);
    ctx.save();
    ctx.translate(cx, cy);

    // Outer obsidian-burgundy bezel track (stationary or rotating smoothly)
    ctx.rotate(wheelAngle);

    // Bezel ring background
    const bezelGrad = ctx.createRadialGradient(0, 0, innerRimRadius, 0, 0, outerRadius);
    bezelGrad.addColorStop(0, "#2b0c18");
    bezelGrad.addColorStop(0.55, "#16060c");
    bezelGrad.addColorStop(1, "#4a2e12");
    ctx.beginPath();
    ctx.arc(0, 0, outerRadius, 0, Math.PI * 2);
    ctx.fillStyle = bezelGrad;
    ctx.fill();

    // Sectors
    for (let i = 0; i < count; i++) {
      const start = i * arc - Math.PI / 2;
      const end = start + arc;

      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.arc(0, 0, innerRimRadius, start, end);
      ctx.closePath();

      const sectorGrad = ctx.createRadialGradient(0, 0, 28, 0, 0, innerRimRadius);
      if (i % 2 === 0) {
        sectorGrad.addColorStop(0, "#240812");
        sectorGrad.addColorStop(0.65, "#420f23");
        sectorGrad.addColorStop(1, "#2a0917");
      } else {
        sectorGrad.addColorStop(0, "#15070d");
        sectorGrad.addColorStop(0.7, "#240d18");
        sectorGrad.addColorStop(1, "#16070e");
      }
      ctx.fillStyle = sectorGrad;
      ctx.fill();

      // Fine antique gold divider line
      ctx.lineWidth = 2.2;
      ctx.strokeStyle = "rgba(231, 194, 132, 0.52)";
      ctx.stroke();

      // Subtle inner arc filigree
      ctx.beginPath();
      ctx.arc(0, 0, innerRimRadius - 14, start + 0.04, end - 0.04);
      ctx.lineWidth = 1;
      ctx.strokeStyle = "rgba(231, 194, 132, 0.22)";
      ctx.stroke();

      // Label & small diamond star (tangent orientation so 12-o'clock winner sits upright & horizontal!)
      const midAngle = start + arc / 2;
      ctx.save();
      ctx.rotate(midAngle + Math.PI / 2);

      ctx.fillStyle = "#e7c284";
      ctx.font = `600 13px Georgia, serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("✦", 0, -(innerRimRadius - 24));

      ctx.fillStyle = i % 2 === 0 ? "#fff4e2" : "#ebd0a7";
      const label = items[i];
      const fontSize = count >= 10 ? 20 : count >= 8 ? 22 : 26;
      ctx.font = `700 ${fontSize}px "Noto Serif SC", "Songti SC", Georgia, serif`;
      ctx.shadowColor = "rgba(0, 0, 0, 0.72)";
      ctx.shadowBlur = 6;

      const textRadius = innerRimRadius - 62;
      if (label.length > 5 && count >= 7) {
        const splitAt = Math.ceil(label.length / 2);
        const line1 = label.slice(0, splitAt);
        const line2 = label.slice(splitAt, splitAt + 5);
        ctx.fillText(line1, 0, -textRadius - fontSize * 0.52);
        ctx.fillText(line2, 0, -textRadius + fontSize * 0.56);
      } else {
        const trimmed = label.length > 6 ? label.slice(0, 6) + "…" : label;
        ctx.fillText(trimmed, 0, -textRadius);
      }
      ctx.restore();
    }

    // Gold ring separating bezel and sectors
    ctx.beginPath();
    ctx.arc(0, 0, innerRimRadius, 0, Math.PI * 2);
    ctx.lineWidth = 3;
    ctx.strokeStyle = "#e7c284";
    ctx.stroke();

    // Inner astrolabe ring around hub
    ctx.beginPath();
    ctx.arc(0, 0, 98, 0, Math.PI * 2);
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = "rgba(231, 194, 132, 0.36)";
    ctx.stroke();

    // Bezel jewel studs (alternating champagne pearl & ruby cabochon)
    const studCount = Math.max(16, count * 2);
    for (let i = 0; i < studCount; i++) {
      const a = (i * Math.PI * 2) / studCount;
      const r = (outerRadius + innerRimRadius) / 2;
      const lx = Math.cos(a) * r;
      const ly = Math.sin(a) * r;
      ctx.beginPath();
      ctx.arc(lx, ly, i % 2 === 0 ? 4.2 : 3.2, 0, Math.PI * 2);
      ctx.fillStyle = i % 2 === 0 ? "#fff0d2" : "#d92b52";
      ctx.fill();
    }

    ctx.restore();
  }

  function spinWheel() {
    if (wheelSpinning) return;
    const items = getWheelItems();
    if (items.length < 2) {
      showToast("席间至少需有 2 个选项方可转动");
      return;
    }

    wheelSpinning = true;
    const startAngle = wheelAngle;
    const extraSpins = 6 + Math.random() * 4;
    const targetDelta = extraSpins * Math.PI * 2 + Math.random() * Math.PI * 2;
    const duration = 3600;
    const startTime = performance.now();
    const arc = (Math.PI * 2) / items.length;
    let lastSector = -1;

    $("wheelFollowActions").classList.add("hidden");
    $("wheelResultTag").textContent = "✦ 星盘流转中 ✦";
    $("wheelResultTitle").textContent = "屏息凝神，静待指针落定...";
    $("wheelResultDesc").textContent = "落定之前，席间诸位切勿私自换座。";

    function animate(now) {
      const elapsed = now - startTime;
      const t = Math.min(elapsed / duration, 1);
      const ease = 1 - Math.pow(1 - t, 3.4);
      wheelAngle = startAngle + targetDelta * ease;
      drawWheel();

      const norm = (((-wheelAngle) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
      const idx = Math.floor(norm / arc) % items.length;
      if (idx !== lastSector) {
        lastSector = idx;
        SFX.tick();
      }

      if (t < 1) {
        requestAnimationFrame(animate);
      } else {
        wheelSpinning = false;
        wheelAngle = wheelAngle % (Math.PI * 2);
        const finalNorm = (((-wheelAngle) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
        const winnerIndex = Math.floor(finalNorm / arc) % items.length;
        const winner = items[winnerIndex];
        SFX.win();

        if (state.wheelMode === "players") {
          lastPickedPlayer = winner;
          $("wheelResultTag").textContent = `✦ 星盘锁定 · ${DATA.levelNames[state.level]} ✦`;
          $("wheelResultTitle").textContent = `今夜受邀主角：「${winner}」`;
          $("wheelResultDesc").textContent = "请即刻从下方择一考验相迎，或再次转动星盘。";
          $("wheelFollowActions").classList.remove("hidden");
        } else {
          lastPickedPlayer = null;
          $("wheelResultTag").textContent = "✦ 酒桌命运已降临 ✦";
          $("wheelResultTitle").textContent = winner;
          $("wheelResultDesc").textContent = "酒令如山，请全场共同见证执行。";
          $("wheelFollowActions").classList.add("hidden");
        }
      }
    }

    requestAnimationFrame(animate);
  }

  // ==================== 2. KING GAME MODULE ====================
  function renderKingSetupPreview() {
    kingRound.count = Math.max(3, Math.min(12, kingRound.count));
    $("kingCountValue").textContent = kingRound.count;
    const preview = $("kingPlayerPreview");
    preview.innerHTML = "";
    for (let i = 0; i < kingRound.count; i++) {
      const name = state.players[i] || `宾客 ${i + 1}`;
      const chip = document.createElement("span");
      chip.className = "preview-chip";
      chip.textContent = name;
      preview.appendChild(chip);
    }
  }

  function startKingRound() {
    SFX.flip();
    const n = kingRound.count;
    const names = Array.from({ length: n }, (_, i) => state.players[i] || `宾客 ${i + 1}`);
    const deck = [{ isKing: true, number: 0 }];
    for (let num = 1; num < n; num++) {
      deck.push({ isKing: false, number: num });
    }
    const shuffledDeck = shuffle(deck);
    kingRound.roles = names.map((playerName, idx) => ({
      playerName,
      ...shuffledDeck[idx],
    }));
    kingRound.currentIndex = 0;
    kingRound.cardFlipped = false;
    kingRound.kingRevealed = false;
    kingRound.activeTargets = [];

    $("kingSetupPane").classList.add("hidden");
    $("kingDecreePane").classList.add("hidden");
    $("kingDealPane").classList.remove("hidden");
    renderCurrentKingDeal();
  }

  function renderCurrentKingDeal() {
    const total = kingRound.roles.length;
    const idx = kingRound.currentIndex;
    const role = kingRound.roles[idx];

    $("kingDealProgressText").textContent = `第 ${idx + 1} / ${total} 位入座者`;
    $("kingCurrentPlayerName").textContent = role.playerName;

    const card = $("kingFlipCard");
    card.classList.remove("flipped");
    kingRound.cardFlipped = false;
    $("kingNextPlayerBtn").classList.add("hidden");

    const backFace = $("kingCardBackFace");
    backFace.classList.toggle("is-king", role.isKing);

    if (role.isKing) {
      $("kingRoleTag").textContent = "✦ THE SOVEREIGN ✦";
      $("kingRoleIcon").textContent = "";
      $("kingRoleTitle").textContent = "至高国王";
      $("kingRoleTip").textContent = "不动声色收好底牌，待全员阅毕后由你执掌圣旨。";
    } else {
      const cn = CN_NUMS[role.number] || role.number;
      $("kingRoleTag").textContent = "✦ SECRET ARCANA ✦";
      $("kingRoleIcon").textContent = `${role.number}`;
      $("kingRoleTitle").textContent = `${cn}号密牌 · ${role.number}号`;
      $("kingRoleTip").textContent = "切勿泄露你的密牌编号，静候国王宣旨。";
    }
  }

  function flipKingCard() {
    if (kingRound.cardFlipped) return;
    kingRound.cardFlipped = true;
    SFX.flip();
    $("kingFlipCard").classList.add("flipped");
    const isLast = kingRound.currentIndex === kingRound.roles.length - 1;
    $("kingNextPlayerBtn").textContent = isLast
      ? "全员阅毕 · 恭请国王登席宣旨"
      : "已铭记于心 · 封牌传给下一位";
    $("kingNextPlayerBtn").classList.remove("hidden");
  }

  function nextKingPlayer() {
    SFX.click();
    if (kingRound.currentIndex < kingRound.roles.length - 1) {
      kingRound.currentIndex += 1;
      renderCurrentKingDeal();
    } else {
      enterKingDecreePane();
    }
  }

  function enterKingDecreePane() {
    $("kingDealPane").classList.add("hidden");
    $("kingDecreePane").classList.remove("hidden");
    $("kingWinnerName").textContent = "待亮明正身";
    $("revealKingBtn").classList.remove("hidden");
    $("decreeLevelBadge").textContent = `${DATA.levelNames[state.level]}圣旨`;
    $("decreeTargetsBadge").textContent = "待抽签";
    $("decreeText").textContent = "轻触下方「抽取皇家圣旨」，系统将随机锁定两个密牌编号并降下今夜指令。";
    $("revealTargetsBtn").disabled = true;
    $("revealedTargetsBox").classList.add("hidden");
    $("revealedTargetsBox").innerHTML = "";
    SFX.win();
  }

  function revealKingIdentity() {
    const king = kingRound.roles.find((r) => r.isKing);
    if (!king) return;
    kingRound.kingRevealed = true;
    SFX.win();
    $("kingWinnerName").textContent = `${king.playerName}（执掌本局）`;
    $("revealKingBtn").classList.add("hidden");
  }

  function drawKingDecree() {
    const maxNum = kingRound.roles.length - 1;
    const nums = shuffle(Array.from({ length: maxNum }, (_, i) => i + 1));
    const n1 = nums[0];
    const n2 = nums[1] || nums[0];
    kingRound.activeTargets = [n1, n2];

    const pool = DATA.kingDecrees[state.level] || DATA.kingDecrees.mild;
    const raw = pickRandom(pool);
    const formatted = raw.replace(/\{N1\}/g, `【${n1}号】`).replace(/\{N2\}/g, `【${n2}号】`);

    SFX.flip();
    $("decreeLevelBadge").textContent = `${DATA.levelNames[state.level]}圣旨`;
    $("decreeTargetsBadge").textContent = `锁定：${n1}号 × ${n2}号`;
    $("decreeText").textContent = formatted;
    $("revealTargetsBtn").disabled = false;
    $("revealedTargetsBox").classList.add("hidden");
  }

  function revealKingTargets() {
    if (!kingRound.activeTargets.length) return;
    SFX.win();
    const lines = kingRound.activeTargets.map((num) => {
      const found = kingRound.roles.find((r) => r.number === num);
      return `✦ <strong>${num} 号密牌</strong> — <strong>${found ? escapeHTML(found.playerName) : "未知"}</strong>`;
    });
    const box = $("revealedTargetsBox");
    box.innerHTML = lines.join("<br/>");
    box.classList.remove("hidden");
  }

  function resetKingToSetup() {
    SFX.click();
    $("kingDealPane").classList.add("hidden");
    $("kingDecreePane").classList.add("hidden");
    $("kingSetupPane").classList.remove("hidden");
    renderKingSetupPreview();
  }

  // ==================== 3. DILEMMA / TRUTH / DARE MODULE ====================
  function switchCardMode(mode, forcedPlayer) {
    cardMode = mode;
    document.querySelectorAll("[data-card-mode]").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.cardMode === mode);
    });
    if (mode === "dilemma") {
      $("dilemmaStage").classList.remove("hidden");
      $("tdStage").classList.add("hidden");
      stopTDTimer();
      renderDilemma();
    } else {
      $("dilemmaStage").classList.add("hidden");
      $("tdStage").classList.remove("hidden");
      drawNextTD(forcedPlayer);
    }
  }

  function renderDilemma() {
    const list = DATA.dilemmas[state.level] || DATA.dilemmas.mild;
    if (dilemmaIndex >= list.length) dilemmaIndex = 0;
    const item = list[dilemmaIndex];
    dilemmaVotes = { a: 0, b: 0 };

    $("dilemmaTag").textContent = `${DATA.levelNames[state.level]} · 少数派饮酒`;
    $("dilemmaCounter").textContent = `NO. ${String(dilemmaIndex + 1).padStart(2, "0")} / ${String(list.length).padStart(2, "0")}`;
    $("dilemmaPrompt").textContent = item.q;
    $("dilemmaTextA").textContent = item.a;
    $("dilemmaTextB").textContent = item.b;
    updateDilemmaVotesUI();
  }

  function updateDilemmaVotesUI() {
    $("dilemmaVotesA").textContent = `${dilemmaVotes.a} 票`;
    $("dilemmaVotesB").textContent = `${dilemmaVotes.b} 票`;
    const bar = $("dilemmaJudgeBar");
    if (dilemmaVotes.a === 0 && dilemmaVotes.b === 0) {
      bar.textContent = "点击 A / B 现场记票，少数派自觉举杯饮尽";
    } else if (dilemmaVotes.a === dilemmaVotes.b) {
      bar.textContent = `票数持平（${dilemmaVotes.a} : ${dilemmaVotes.b}）— 全场共同举杯轻抿一口`;
    } else if (dilemmaVotes.a < dilemmaVotes.b) {
      bar.textContent = `A 方为少数派（${dilemmaVotes.a} 票）— 投 A 者请自觉罚饮一口`;
    } else {
      bar.textContent = `B 方为少数派（${dilemmaVotes.b} 票）— 投 B 者请自觉罚饮一口`;
    }
  }

  function getTDPool() {
    if (cardMode === "truth") {
      return [...(DATA.truths[state.level] || DATA.truths.mild), ...state.customTruths];
    }
    return [...(DATA.dares[state.level] || DATA.dares.mild), ...state.customDares];
  }

  function drawNextTD(forcedPlayer) {
    stopTDTimer();
    resetTDTimerUI();
    $("tdPunishToast").classList.add("hidden");

    const pool = getTDPool();
    const raw = pickRandom(pool);
    const filled = fillPlaceholders(raw, forcedPlayer);

    const entry = {
      mode: cardMode,
      level: state.level,
      playerA: filled.playerA,
      text: filled.text,
    };

    tdHistory = tdHistory.slice(0, tdCursor + 1);
    tdHistory.push(entry);
    tdCursor = tdHistory.length - 1;
    SFX.flip();
    renderCurrentTD();
  }

  function renderCurrentTD() {
    const entry = tdHistory[tdCursor];
    if (!entry) return;
    const isTruth = entry.mode === "truth";
    $("tdModeTag").textContent = `${DATA.levelNames[entry.level]} · ${isTruth ? "真心话" : "大冒险"}`;
    $("tdModeTag").className = `tag-pill ${isTruth ? "gold" : "rose"}`;
    $("tdVictimLine").innerHTML = `本轮受邀主角：<strong>${escapeHTML(entry.playerA)}</strong>`;
    $("tdContent").textContent = entry.text;
    const charmEl = $("tdWaterCharm");
    if (charmEl && DATA.levelCharms[entry.level]) {
      charmEl.src = DATA.levelCharms[entry.level];
    }
    $("tdPrevBtn").disabled = tdCursor <= 0;
  }

  function stopTDTimer() {
    if (tdTimerId) {
      clearInterval(tdTimerId);
      tdTimerId = null;
    }
  }

  function resetTDTimerUI() {
    tdSeconds = 30;
    $("tdTimerText").textContent = "30s";
    $("tdTimerStartBtn").textContent = "开启读秒";
  }

  function toggleTDTimer() {
    if (tdTimerId) {
      stopTDTimer();
      $("tdTimerStartBtn").textContent = "继续读秒";
      return;
    }
    if (tdSeconds <= 0) tdSeconds = 30;
    SFX.click();
    $("tdTimerStartBtn").textContent = "暂停";
    tdTimerId = setInterval(() => {
      tdSeconds -= 1;
      $("tdTimerText").textContent = `${tdSeconds}s`;
      if (tdSeconds <= 5 && tdSeconds > 0) SFX.tick();
      if (tdSeconds <= 0) {
        stopTDTimer();
        SFX.alert();
        $("tdTimerStartBtn").textContent = "重置 30s";
        const box = $("tdPunishToast");
        box.textContent = "读秒归零 — 犹豫不决者请直接自罚半杯！";
        box.classList.remove("hidden");
      }
    }, 1000);
  }

  // ==================== 4. DICE CUP MODULE ====================
  const PIP_MAP = {
    1: [4],
    2: [0, 8],
    3: [0, 4, 8],
    4: [0, 2, 6, 8],
    5: [0, 2, 4, 6, 8],
    6: [0, 2, 3, 5, 6, 8],
  };

  function renderDiceTray(rolling = false) {
    const tray = $("diceTray");
    tray.innerHTML = "";
    diceValues.forEach((val) => {
      const die = document.createElement("div");
      die.className = `die-face${rolling ? " rolling" : ""}`;
      const activePips = PIP_MAP[val];
      for (let cell = 0; cell < 9; cell++) {
        const slot = document.createElement("span");
        if (activePips.includes(cell)) {
          slot.className = `pip${val === 1 || val === 4 ? " red" : ""}`;
        }
        die.appendChild(slot);
      }
      tray.appendChild(die);
    });
  }

  function updateDiceCover() {
    const cover = $("diceCover");
    if (!dicePeekMode || diceOpened) {
      cover.classList.add("opened");
      cover.classList.remove("peeking");
    } else {
      cover.classList.remove("opened");
    }
    $("togglePeekModeBtn").textContent = `暗盅防窥：${dicePeekMode ? "开" : "关"}`;
  }

  function rollDice() {
    if (diceRolling) return;
    diceRolling = true;
    diceOpened = false;
    updateDiceCover();
    SFX.dice();
    renderDiceTray(true);
    $("diceSummary").textContent = "皮盅急摇中，骰点正在洗牌...";

    setTimeout(() => {
      diceValues = Array.from({ length: 5 }, () => 1 + Math.floor(Math.random() * 6)).sort((a, b) => a - b);
      diceRolling = false;
      renderDiceTray(false);
      $("diceSummary").textContent = dicePeekMode
        ? "已落盅封严 · 按住上方皮盅可掀缝暗窥，开牌请点「开盅亮牌」"
        : `当前骰点：${diceValues.join(" · ")}（合计 ${diceValues.reduce((a, b) => a + b, 0)} 点）`;
    }, 520);
  }

  // ==================== PLAYERS MODAL ====================
  function renderPlayersModalList() {
    const ul = $("playerListEl");
    ul.innerHTML = "";
    state.players.forEach((name, idx) => {
      const li = document.createElement("li");
      li.className = "player-item";
      const grad = AVATAR_COLORS[idx % AVATAR_COLORS.length];
      li.innerHTML = `
        <div class="player-item-left">
          <span class="player-avatar" style="background:${grad}">${escapeHTML(name.slice(0, 1))}</span>
          <span>${escapeHTML(name)}</span>
        </div>
        <button class="player-remove-btn" data-remove-player="${idx}">离席</button>
      `;
      ul.appendChild(li);
    });
  }

  function escapeHTML(str) {
    return String(str).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  function addPlayer() {
    const input = $("newPlayerInput");
    const val = input.value.trim();
    if (!val) return;
    if (state.players.length >= 12) {
      showToast("单席至多容纳 12 位宾客");
      return;
    }
    if (state.players.includes(val)) {
      showToast("席间已有同名好友");
      return;
    }
    state.players.push(val);
    kingRound.count = Math.min(12, state.players.length);
    input.value = "";
    saveState();
    syncGlobalUI();
    SFX.click();
  }

  // ==================== EVENT BINDINGS ====================
  function bindEvents() {
    $("closeBrowserTip").addEventListener("click", () => $("browserTip").classList.add("hidden"));

    document.querySelectorAll(".nav-item").forEach((btn) => {
      btn.addEventListener("click", () => switchTab(btn.dataset.target));
    });

    $("toggleSoundBtn").addEventListener("click", () => {
      state.sound = !state.sound;
      saveState();
      syncGlobalUI();
      if (state.sound) SFX.click();
      showToast(state.sound ? "已开启酒馆音效" : "已切换至静音");
    });

    document.querySelectorAll(".intensity-chip").forEach((chip) => {
      chip.addEventListener("click", () => {
        state.level = chip.dataset.level;
        saveState();
        syncGlobalUI();
        SFX.click();
        showToast(`已切换至「${DATA.levelNames[state.level]}」`);
        if (currentTab === "cards") {
          if (cardMode === "dilemma") {
            dilemmaIndex = 0;
            renderDilemma();
          } else {
            drawNextTD();
          }
        }
      });
    });

    document.querySelectorAll("[data-wheel-mode]").forEach((btn) => {
      btn.addEventListener("click", () => {
        state.wheelMode = btn.dataset.wheelMode;
        saveState();
        SFX.click();
        document.querySelectorAll("[data-wheel-mode]").forEach((b) => {
          b.classList.toggle("active", b.dataset.wheelMode === state.wheelMode);
        });
        $("wheelFollowActions").classList.add("hidden");
        drawWheel();
      });
    });

    $("spinWheelBtn").addEventListener("click", spinWheel);

    document.querySelectorAll("[data-quick-draw]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const mode = btn.dataset.quickDraw;
        switchTab("cards");
        switchCardMode(mode, lastPickedPlayer);
      });
    });

    $("quickDrinkPunishBtn").addEventListener("click", () => {
      SFX.alert();
      const punish = pickRandom(DATA.quickDrinkPunishments);
      $("wheelResultTag").textContent = `✦ 特调罚酒令 · ${lastPickedPlayer || "受邀者"} ✦`;
      $("wheelResultDesc").textContent = punish;
    });

    $("editWheelBtn").addEventListener("click", () => {
      $("wheelSectorsTextarea").value = state.drinkWheel.join("\n");
      $("wheelEditModal").classList.remove("hidden");
    });

    $("saveWheelSectorsBtn").addEventListener("click", () => {
      const lines = $("wheelSectorsTextarea")
        .value.split(/\r?\n/)
        .map((s) => s.trim())
        .filter(Boolean);
      if (lines.length < 2) {
        showToast("请至少填写 2 条酒令");
        return;
      }
      state.drinkWheel = lines.slice(0, 12);
      state.wheelMode = "drinks";
      saveState();
      document.querySelectorAll("[data-wheel-mode]").forEach((b) => {
        b.classList.toggle("active", b.dataset.wheelMode === "drinks");
      });
      drawWheel();
      $("wheelEditModal").classList.add("hidden");
      showToast("命运星盘已重新镌刻");
    });

    $("resetWheelDefaultBtn").addEventListener("click", () => {
      state.drinkWheel = [...DATA.defaultDrinkWheel];
      $("wheelSectorsTextarea").value = state.drinkWheel.join("\n");
      saveState();
      drawWheel();
      showToast("已恢复经典盘面");
    });

    // King Game controls
    $("kingCountMinus").addEventListener("click", () => {
      kingRound.count = Math.max(3, kingRound.count - 1);
      SFX.click();
      renderKingSetupPreview();
    });
    $("kingCountPlus").addEventListener("click", () => {
      kingRound.count = Math.min(12, kingRound.count + 1);
      SFX.click();
      renderKingSetupPreview();
    });
    $("startKingRoundBtn").addEventListener("click", startKingRound);
    $("kingFlipCard").addEventListener("click", flipKingCard);
    $("kingNextPlayerBtn").addEventListener("click", nextKingPlayer);
    $("kingResetFromDealBtn").addEventListener("click", resetKingToSetup);
    $("kingRestartBtn").addEventListener("click", resetKingToSetup);
    $("revealKingBtn").addEventListener("click", revealKingIdentity);
    $("drawDecreeBtn").addEventListener("click", drawKingDecree);
    $("revealTargetsBtn").addEventListener("click", revealKingTargets);

    $("applyCustomDecreeBtn").addEventListener("click", () => {
      const val = $("customDecreeInput").value.trim();
      if (!val) return;
      SFX.win();
      $("decreeLevelBadge").textContent = "国王御笔亲拟";
      $("decreeTargetsBadge").textContent = "钦定圣旨";
      $("decreeText").textContent = val;
      $("customDecreeInput").value = "";
      const matches = [...val.matchAll(/(\d+)\s*号/g)].map((m) => parseInt(m[1], 10));
      const validNums = [...new Set(matches)].filter((n) => n >= 1 && n < kingRound.roles.length);
      kingRound.activeTargets = validNums;
      $("revealTargetsBtn").disabled = validNums.length === 0;
      $("revealedTargetsBox").classList.add("hidden");
    });

    // Cards controls
    document.querySelectorAll("[data-card-mode]").forEach((btn) => {
      btn.addEventListener("click", () => {
        SFX.click();
        switchCardMode(btn.dataset.cardMode);
      });
    });

    $("dilemmaOptA").addEventListener("click", () => {
      dilemmaVotes.a += 1;
      SFX.tick();
      updateDilemmaVotesUI();
    });
    $("dilemmaOptB").addEventListener("click", () => {
      dilemmaVotes.b += 1;
      SFX.tick();
      updateDilemmaVotesUI();
    });
    $("resetDilemmaVotesBtn").addEventListener("click", () => {
      dilemmaVotes = { a: 0, b: 0 };
      SFX.click();
      updateDilemmaVotesUI();
    });
    $("nextDilemmaBtn").addEventListener("click", () => {
      dilemmaIndex += 1;
      SFX.flip();
      renderDilemma();
    });

    $("tdNextBtn").addEventListener("click", () => drawNextTD());
    $("tdPrevBtn").addEventListener("click", () => {
      if (tdCursor > 0) {
        tdCursor -= 1;
        SFX.click();
        renderCurrentTD();
      }
    });
    $("pickRandomVictimBtn").addEventListener("click", () => {
      const chosen = pickRandom(state.players);
      SFX.win();
      drawNextTD(chosen);
      showToast(`已锁定「${chosen}」接招`);
    });
    $("tdTimerStartBtn").addEventListener("click", toggleTDTimer);
    $("tdDrinkPassBtn").addEventListener("click", () => {
      stopTDTimer();
      SFX.alert();
      const box = $("tdPunishToast");
      box.textContent = `认怂罚饮：${pickRandom(DATA.quickDrinkPunishments)}`;
      box.classList.remove("hidden");
    });

    // Custom card modal
    $("openCustomCardBtn").addEventListener("click", () => {
      customCardType = cardMode === "dare" ? "dare" : "truth";
      document.querySelectorAll("[data-custom-type]").forEach((b) => {
        b.classList.toggle("active", b.dataset.customType === customCardType);
      });
      $("customCardTextarea").value = "";
      $("customCardModal").classList.remove("hidden");
    });
    document.querySelectorAll("[data-custom-type]").forEach((btn) => {
      btn.addEventListener("click", () => {
        customCardType = btn.dataset.customType;
        document.querySelectorAll("[data-custom-type]").forEach((b) => {
          b.classList.toggle("active", b.dataset.customType === customCardType);
        });
      });
    });
    $("saveCustomCardBtn").addEventListener("click", () => {
      const text = $("customCardTextarea").value.trim();
      if (!text) {
        showToast("请先写下牌面内容");
        return;
      }
      if (customCardType === "truth") state.customTruths.push(text);
      else state.customDares.push(text);
      saveState();
      $("customCardModal").classList.add("hidden");
      showToast("私房牌已混入牌堆");
      if (cardMode === customCardType) drawNextTD();
    });

    // Dice Cup controls
    $("rollDiceBtn").addEventListener("click", rollDice);
    $("togglePeekModeBtn").addEventListener("click", () => {
      dicePeekMode = !dicePeekMode;
      diceOpened = !dicePeekMode;
      SFX.click();
      updateDiceCover();
    });
    $("revealDiceAllBtn").addEventListener("click", () => {
      diceOpened = true;
      SFX.win();
      updateDiceCover();
      $("diceSummary").textContent = `开盅亮牌：${diceValues.join(" · ")}（合计 ${diceValues.reduce(
        (a, b) => a + b,
        0
      )} 点）`;
    });

    const cover = $("diceCover");
    const startPeek = (e) => {
      e.preventDefault();
      if (!dicePeekMode || diceOpened) return;
      cover.classList.add("peeking");
      SFX.tick();
    };
    const endPeek = () => {
      cover.classList.remove("peeking");
    };
    cover.addEventListener("mousedown", startPeek);
    cover.addEventListener("touchstart", startPeek, { passive: false });
    window.addEventListener("mouseup", endPeek);
    window.addEventListener("touchend", endPeek);
    window.addEventListener("touchcancel", endPeek);

    // Players modal controls
    $("openPlayersBtn").addEventListener("click", () => {
      renderPlayersModalList();
      $("playersModal").classList.remove("hidden");
    });
    $("addPlayerBtn").addEventListener("click", addPlayer);
    $("newPlayerInput").addEventListener("keydown", (e) => {
      if (e.key === "Enter") addPlayer();
    });

    $("playerListEl").addEventListener("click", (e) => {
      const btn = e.target.closest("[data-remove-player]");
      if (!btn) return;
      if (state.players.length <= 2) {
        showToast("席间至少保留 2 位宾客");
        return;
      }
      const idx = parseInt(btn.dataset.removePlayer, 10);
      state.players.splice(idx, 1);
      kingRound.count = Math.max(3, Math.min(12, state.players.length));
      saveState();
      syncGlobalUI();
      SFX.click();
    });

    document.querySelectorAll("[data-preset-count]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const count = parseInt(btn.dataset.presetCount, 10);
        const defaults = ["阿哲", "小满", "林野", "甜茶", "周舟", "陆离", "七七", "阿杰", "晚晚", "陈皮"];
        state.players = defaults.slice(0, count);
        kingRound.count = Math.max(3, Math.min(12, count));
        saveState();
        syncGlobalUI();
        SFX.click();
        showToast(`已切换为 ${count} 人席位`);
      });
    });

    document.querySelectorAll("[data-close-modal]").forEach((btn) => {
      btn.addEventListener("click", () => {
        $(btn.dataset.closeModal).classList.add("hidden");
      });
    });
    document.querySelectorAll(".modal-backdrop").forEach((backdrop) => {
      backdrop.addEventListener("click", (e) => {
        if (e.target === backdrop) backdrop.classList.add("hidden");
      });
    });
  }

  // ==================== INIT ====================
  function init() {
    detectInAppBrowser();
    bindEvents();
    document.querySelectorAll("[data-wheel-mode]").forEach((b) => {
      b.classList.toggle("active", b.dataset.wheelMode === state.wheelMode);
    });
    syncGlobalUI();
    renderDilemma();
    renderDiceTray(false);
    updateDiceCover();
  }

  init();
})();
