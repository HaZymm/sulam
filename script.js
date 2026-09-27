(function () {
  "use strict";

  var app = document.getElementById("app");
  var questionBank = window.QUESTION_BANK;
  var gameI18n = window.GAME_I18N;

  if (!app || !Array.isArray(questionBank) || !gameI18n) {
    document.body.innerHTML =
      '<main style="padding:40px;color:white;font-family:system-ui;background:#050911;min-height:100vh">' +
      "<h1>AI IMPOSTOR</h1><p>The local question file could not be loaded.</p></main>";
    return;
  }

  var TOTAL_ROUNDS = 10;
  var READ_SECONDS = 5;
  var ANSWER_SECONDS = 10;
  var FEEDBACK_DELAY_MS = 3000;
  var SMART_SCORE_MULTIPLIER = 1.12;
  var LEADERBOARD_KEY = "ai-impostor-device-leaderboard-v3";
  var difficultyOrder = ["Easy", "Medium", "Hard"];
  var categories = gameI18n.categoryOptions;
  var difficulties = gameI18n.difficultyOptions;
  var formatMeta = gameI18n.formatMeta;
  var ui = gameI18n.ui;
  var formatTemplate = ["impostor", "impostor", "impostor", "impostor", "impostor", "impostor", "squad", "squad", "fake-fact", "fake-fact"];

  var difficultyMultiplier = { Easy: 1, Medium: 1.2, Hard: 1.45 };
  var formatMultiplier = { impostor: 1, squad: 1.08, "fake-fact": 1.12 };

  var savedLanguage = window.localStorage.getItem("ai-impostor-language");
  var savedSound = window.localStorage.getItem("ai-impostor-sound");
  var savedMusicVolume = Number(window.localStorage.getItem("ai-impostor-music-volume"));

  var state = {
    screen: "home",
    showHowTo: false,
    showClearLeaderboard: false,
    language: savedLanguage === "ms" ? "ms" : "en",
    nickname: "",
    nicknameError: "",
    category: "Random",
    challengeMode: "smart",
    difficulty: "Easy",
    nextAdaptiveDifficulty: "Medium",
    boothMode: false,
    soundEnabled: savedSound === "false" ? false : true,
    musicVolume: Number.isFinite(savedMusicVolume) && savedMusicVolume >= 0 && savedMusicVolume <= 1 ? savedMusicVolume : 0.35,
    roundFormatPlan: formatTemplate.slice(),
    rounds: [],
    roundIndex: 0,
    score: 0,
    correctCount: 0,
    streak: 0,
    bestStreak: 0,
    roundPhase: "reading",
    countdownValue: 3,
    timeLeft: READ_SECONDS,
    selectedIndex: null,
    outcome: null,
    scoreBreakdown: null,
    responseTimes: [],
    roundHistory: [],
    hostReaction: {
      label: { en: "Nova · AI Host", ms: "Nova · Hos AI" },
      headline: { en: "Ready when you are", ms: "Sedia apabila anda bersedia" },
      message: {
        en: "I’ll react to your speed, accuracy and streak as you play.",
        ms: "Saya akan bertindak balas terhadap kelajuan, ketepatan dan rentetan anda semasa bermain.",
      },
      tone: "neutral",
    },
    feedbackProgress: 0,
    leaderboard: readLeaderboard(),
    leaderboardQuery: "",
    leaderboardNotice: "",
    playerRank: null,
    savedEntryId: null,
    roundStartedAt: 0,
    timerFrame: 0,
    countdownTimer: 0,
    feedbackFrame: 0,
    advanceTimer: 0,
  };

  function escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function localized(en, ms) {
    return { en: en, ms: ms };
  }

  function localize(value) {
    if (value && typeof value === "object" && value.en && value.ms) return value[state.language];
    return String(value == null ? "" : value);
  }

  function t(key) {
    return ui[state.language][key];
  }

  function fill(template, values) {
    return Object.keys(values).reduce(function (result, key) {
      return result.replace("{" + key + "}", String(values[key]));
    }, template);
  }

  function highlightedQuestion(question) {
    var value = localize(question.question);
    var phrases = {
      impostor: localized("does NOT match", "TIDAK sepadan"),
      squad: localized("Complete the group", "Lengkapkan kumpulan"),
      "fake-fact": localized("false", "salah"),
    };
    var phrase = localize(phrases[question.format]);
    var start = value.toLocaleLowerCase().indexOf(phrase.toLocaleLowerCase());
    if (start < 0) return escapeHtml(value);
    return escapeHtml(value.slice(0, start)) + "<mark>" + escapeHtml(value.slice(start, start + phrase.length)) + "</mark>" + escapeHtml(value.slice(start + phrase.length));
  }

  function categoryLabel(category) {
    var option = categories.find(function (entry) { return entry.name === category; });
    if (option) return localize(option.label);
    var legacyLabels = {
      Food: localized("Food", "Makanan"),
      Animals: localized("Animals", "Haiwan"),
      Countries: localized("Countries", "Negara"),
      Movies: localized("Movies", "Filem"),
      Games: localized("Games", "Permainan"),
    };
    return legacyLabels[category] ? localize(legacyLabels[category]) : category;
  }

  function difficultyLabel(difficulty) {
    var option = difficulties.find(function (entry) { return entry.name === difficulty; });
    if (option) return localize(option.label);
    if (difficulty === "Smart Challenge") return t("smartChallenge");
    return difficulty;
  }

  function difficultyLabelFor(difficulty, language) {
    var option = difficulties.find(function (entry) { return entry.name === difficulty; });
    if (option) return option.label[language];
    if (difficulty === "Smart Challenge") return ui[language].smartChallenge;
    return difficulty;
  }

  function formatNumber(value) {
    return Number(value).toLocaleString(state.language === "ms" ? "ms-MY" : "en-MY");
  }

  function resultCount(count) {
    return count + " " + t(count === 1 ? "result" : "resultsPlural");
  }

  function shuffle(values) {
    var copy = values.slice();
    for (var index = copy.length - 1; index > 0; index -= 1) {
      var swapIndex = Math.floor(Math.random() * (index + 1));
      var temporary = copy[index];
      copy[index] = copy[swapIndex];
      copy[swapIndex] = temporary;
    }
    return copy;
  }

  function shuffleQuestion(question) {
    var taggedItems = question.items.map(function (item, originalIndex) {
      return { item: item, originalIndex: originalIndex };
    });
    var mixedItems = shuffle(taggedItems);
    return Object.assign({}, question, {
      items: mixedItems.map(function (entry) { return entry.item; }),
      answer: mixedItems.findIndex(function (entry) {
        return entry.originalIndex === question.answer;
      }),
    });
  }

  function createFormatPlan() {
    return shuffle(formatTemplate);
  }

  function chooseRounds(eligible, formatPlan) {
    var usedFamilyIds = new Set();
    return formatPlan.map(function (format) {
      var selected = shuffle(eligible).find(function (question) {
        return question.format === format && !usedFamilyIds.has(question.familyId);
      });
      if (!selected) throw new Error("No unused " + format + " question is available.");
      usedFamilyIds.add(selected.familyId);
      return shuffleQuestion(selected);
    });
  }

  function stepDifficulty(current, amount) {
    var currentIndex = difficultyOrder.indexOf(current);
    return difficultyOrder[Math.max(0, Math.min(difficultyOrder.length - 1, currentIndex + amount))];
  }

  function chooseAdaptiveQuestion(category, difficulty, usedFamilyIds, format) {
    var fallbackOrder = [difficulty].concat(difficultyOrder.filter(function (level) {
      return level !== difficulty;
    }));

    for (var levelIndex = 0; levelIndex < fallbackOrder.length; levelIndex += 1) {
      var level = fallbackOrder[levelIndex];
      var eligible = questionBank.filter(function (question) {
        return question.difficulty === level &&
          question.format === format &&
          (category === "Random" || question.category === category) &&
          !usedFamilyIds.has(question.familyId);
      });
      var selected = shuffle(eligible)[0];
      if (selected) return shuffleQuestion(selected);
    }
    throw new Error("No unused questions are available for this challenge.");
  }

  function nextSmartDifficulty(current, outcome, responseTime, nextStreak) {
    if (outcome !== "correct") return stepDifficulty(current, -1);
    if (responseTime <= 4.5 || nextStreak >= 2) return stepDifficulty(current, 1);
    return current;
  }

  function roundIntro(nickname, roundNumber, mode, difficulty) {
    if (mode === "classic") {
      return {
        label: localized("Nova · AI Host", "Nova · Hos AI"),
        headline: localized(
          roundNumber === 1 ? difficultyLabelFor(difficulty, "en") + " category ready" : "Round " + roundNumber + " is live",
          roundNumber === 1 ? "Kategori " + difficultyLabelFor(difficulty, "ms") + " sudah siap" : "Pusingan " + roundNumber + " bermula"
        ),
        message: localized(
          roundNumber === 1
            ? nickname + ", your chosen level is locked. Show me your sharpest pattern skills."
            : "A new pattern is ready. Read carefully and answer quickly.",
          roundNumber === 1
            ? nickname + ", tahap pilihan anda dikekalkan. Tunjukkan kemahiran corak terbaik anda."
            : "Corak baharu sudah siap. Baca dengan teliti dan jawab dengan pantas."
        ),
        tone: "neutral",
      };
    }

    var messages = {
      Easy: localized(
        "I’ve made the pattern friendlier so you can rebuild momentum.",
        "Saya menjadikan corak lebih mudah supaya anda dapat membina semula momentum."
      ),
      Medium: localized(
        roundNumber === 1
          ? nickname + ", this is your calibration round. I’ll tune the next challenge to your play."
          : "I’m testing your balance of speed and accuracy at this level.",
        roundNumber === 1
          ? nickname + ", ini pusingan kalibrasi anda. Saya akan menyesuaikan cabaran seterusnya mengikut permainan anda."
          : "Saya sedang menguji keseimbangan kelajuan dan ketepatan anda pada tahap ini."
      ),
      Hard: localized(
        "You earned a more complex pattern. Look closely.",
        "Anda memperoleh corak yang lebih kompleks. Perhatikan dengan teliti."
      ),
    };
    return {
      label: localized(
        roundNumber === 1 ? "Nova · AI Host · Calibration" : "Nova · AI Host · Smart scan",
        roundNumber === 1 ? "Nova · Hos AI · Kalibrasi" : "Nova · Hos AI · Imbasan pintar"
      ),
      headline: localized(
        roundNumber === 1 ? "Let’s discover your level" : difficultyLabelFor(difficulty, "en") + " pattern selected",
        roundNumber === 1 ? "Mari tentukan tahap anda" : "Corak " + difficultyLabelFor(difficulty, "ms") + " dipilih"
      ),
      message: messages[difficulty],
      tone: difficulty === "Hard" ? "level-up" : "neutral",
    };
  }

  function answerReaction(options) {
    var levelChanged = options.mode === "smart" && options.currentDifficulty !== options.upcomingDifficulty;
    if (options.outcome === "correct" && levelChanged &&
      difficultyOrder.indexOf(options.upcomingDifficulty) > difficultyOrder.indexOf(options.currentDifficulty)) {
      return {
        label: localized("Nova · AI Host · Performance analysed", "Nova · Hos AI · Prestasi dianalisis"),
        headline: localized("That was too easy for you!", "Itu terlalu mudah untuk anda!"),
        message: localized(
          options.nickname + ", I’m raising the next round to " + difficultyLabelFor(options.upcomingDifficulty, "en") + ". Your Smart bonus is active.",
          options.nickname + ", saya menaikkan pusingan seterusnya kepada " + difficultyLabelFor(options.upcomingDifficulty, "ms") + ". Bonus Pintar anda aktif."
        ),
        tone: "level-up",
      };
    }
    if (options.outcome === "correct" && options.responseTime <= 2.5) {
      return {
        label: localized("Nova · AI Host · Instant reaction", "Nova · Hos AI · Reaksi segera"),
        headline: localized("Lightning-fast pattern read!", "Pengecaman corak sepantas kilat!"),
        message: localized(
          "Only " + options.responseTime.toFixed(1) + " seconds. You answered before I finished scanning.",
          "Hanya " + options.responseTime.toFixed(1) + " saat. Anda menjawab sebelum saya selesai mengimbas."
        ),
        tone: "celebrate",
      };
    }
    if (options.outcome === "correct" && options.streak >= 3) {
      return {
        label: localized("Nova · AI Host · Streak detected", "Nova · Hos AI · Rentetan dikesan"),
        headline: localized(options.streak + " correct answers in a row", options.streak + " jawapan betul berturut-turut"),
        message: localized(
          "Your pattern recognition is getting stronger. Keep the streak for a bigger bonus.",
          "Pengecaman corak anda semakin kuat. Kekalkan rentetan untuk bonus lebih besar."
        ),
        tone: "celebrate",
      };
    }
    if (options.outcome === "correct") {
      return {
        label: localized("Nova · AI Host · Pattern confirmed", "Nova · Hos AI · Corak disahkan"),
        headline: localized("Correct decision", "Keputusan yang betul"),
        message: localized(
          options.mode === "smart"
            ? "Correct, " + options.nickname + ". I’m using your speed and accuracy to choose what comes next."
            : "Correct, " + options.nickname + ". Keep building that streak.",
          options.mode === "smart"
            ? "Betul, " + options.nickname + ". Saya menggunakan kelajuan dan ketepatan anda untuk memilih cabaran seterusnya."
            : "Betul, " + options.nickname + ". Terus bina rentetan itu."
        ),
        tone: "celebrate",
      };
    }
    if (options.outcome === "timeout") {
      return {
        label: localized("Nova · AI Host · Time analysis", "Nova · Hos AI · Analisis masa"),
        headline: localized("Time ran out", "Masa telah tamat"),
        message: localized(
          options.mode === "smart"
            ? "No problem—I’m adjusting the next round to " + difficultyLabelFor(options.upcomingDifficulty, "en") + " so you can recover."
            : "Take a breath and answer the next pattern earlier.",
          options.mode === "smart"
            ? "Tidak mengapa—saya menyesuaikan pusingan seterusnya kepada " + difficultyLabelFor(options.upcomingDifficulty, "ms") + " supaya anda boleh bangkit semula."
            : "Tarik nafas dan jawab corak seterusnya dengan lebih awal."
        ),
        tone: "encourage",
      };
    }
    return {
      label: localized("Nova · AI Host · Choice analysed", "Nova · Hos AI · Pilihan dianalisis"),
      headline: localized("That impostor was tricky", "Penyamar itu agak mencabar"),
      message: localized(
        levelChanged
          ? "I’m moving the next round to " + difficultyLabelFor(options.upcomingDifficulty, "en") + ". Rebuild your momentum, " + options.nickname + "."
          : "Read the explanation and look for the next hidden link.",
        levelChanged
          ? "Saya menukar pusingan seterusnya kepada " + difficultyLabelFor(options.upcomingDifficulty, "ms") + ". Bina semula momentum anda, " + options.nickname + "."
          : "Baca penjelasan dan cari hubungan tersembunyi seterusnya."
      ),
      tone: "encourage",
    };
  }

  function buildPlayerProfile(records, bestStreak) {
    var correct = records.filter(function (record) { return record.correct; }).length;
    var average = records.length
      ? records.reduce(function (sum, record) { return sum + record.responseTime; }, 0) / records.length
      : 0;
    var firstHalf = records.slice(0, 5).filter(function (record) { return record.correct; }).length;
    var secondHalf = records.slice(5).filter(function (record) { return record.correct; }).length;
    var hardWins = records.filter(function (record) {
      return record.correct && record.difficulty === "Hard";
    }).length;
    var reachedHard = records.some(function (record) { return record.difficulty === "Hard"; });
    var profile;

    if (correct === TOTAL_ROUNDS) {
      profile = { icon: "👑", title: localized("Impostor Genius", "Genius Penyamar"), tagline: localized("Perfect patterns. Zero escapes.", "Corak sempurna. Tiada yang terlepas."), description: localized("You combined accuracy, focus and consistency to crack every challenge.", "Anda menggabungkan ketepatan, fokus dan konsistensi untuk menyelesaikan setiap cabaran.") };
    } else if (average <= 3.4 && correct >= 6) {
      profile = { icon: "⚡", title: localized("Lightning Thinker", "Pemikir Sepantas Kilat"), tagline: localized("You decide before others finish reading.", "Anda membuat keputusan sebelum orang lain selesai membaca."), description: localized("Fast visual decisions are your strength—your instincts identify patterns immediately.", "Keputusan visual yang pantas ialah kekuatan anda—naluri anda mengenal pasti corak dengan segera.") };
    } else if (secondHalf >= firstHalf + 2 && secondHalf >= 4) {
      profile = { icon: "🚀", title: localized("Comeback Hero", "Wira Kebangkitan"), tagline: localized("The longer you play, the stronger you become.", "Semakin lama anda bermain, semakin kuat prestasi anda."), description: localized("You adapted during the challenge and finished with your best performance.", "Anda menyesuaikan diri sepanjang cabaran dan menamatkannya dengan prestasi terbaik.") };
    } else if (correct >= 8 || bestStreak >= 5) {
      profile = { icon: "🕵️", title: localized("Pattern Detective", "Detektif Corak"), tagline: localized("Hidden relationships rarely fool you.", "Hubungan tersembunyi jarang mengelirukan anda."), description: localized("Strong accuracy and long streaks show careful, reliable pattern recognition.", "Ketepatan tinggi dan rentetan panjang menunjukkan pengecaman corak yang teliti dan boleh dipercayai.") };
    } else if (hardWins >= 2) {
      profile = { icon: "🧗", title: localized("Challenge Climber", "Pendaki Cabaran"), tagline: localized("Complex patterns bring out your best.", "Corak kompleks menyerlahkan kemampuan terbaik anda."), description: localized("You won at the toughest level and kept working through difficult clues.", "Anda menang pada tahap paling sukar dan terus berusaha menyelesaikan petunjuk yang mencabar.") };
    } else if (bestStreak >= 3) {
      profile = { icon: "🔥", title: localized("Streak Hunter", "Pemburu Rentetan"), tagline: localized("Once you find your rhythm, you are hard to stop.", "Apabila anda menemui rentak, anda sukar dihentikan."), description: localized("Momentum is your strength. Connected wins quickly become a strong scoring run.", "Momentum ialah kekuatan anda. Kemenangan berturut-turut pantas menjadi rentetan markah yang hebat.") };
    } else {
      profile = { icon: "🧭", title: localized("Curious Explorer", "Peneroka Ingin Tahu"), tagline: localized("Every pattern is a new discovery.", "Setiap corak ialah penemuan baharu."), description: localized("You try unfamiliar clues confidently and learn from every explanation.", "Anda mencuba petunjuk baharu dengan yakin dan belajar daripada setiap penjelasan.") };
    }

    profile.traits = [
      localized(correct + "/" + TOTAL_ROUNDS + " patterns cracked", correct + "/" + TOTAL_ROUNDS + " corak diselesaikan"),
      localized(average.toFixed(1) + "s average reaction", average.toFixed(1) + "s purata tindak balas"),
      hardWins > 0
        ? localized(hardWins + " Hard-level win" + (hardWins === 1 ? "" : "s"), hardWins + " kemenangan tahap Sukar")
        : reachedHard
          ? localized("Reached Hard difficulty", "Mencapai tahap Sukar")
          : localized(bestStreak + " best streak", bestStreak + " rentetan terbaik"),
    ];
    return profile;
  }

  function readLeaderboard() {
    try {
      var parsed = JSON.parse(window.localStorage.getItem(LEADERBOARD_KEY) || "[]");
      return Array.isArray(parsed) ? rankLeaderboard(parsed) : [];
    } catch {
      return [];
    }
  }

  function rankLeaderboard(entries) {
    return entries.slice().sort(function (left, right) {
      return right.score - left.score ||
        right.correctAnswers - left.correctAnswers ||
        left.averageResponseMs - right.averageResponseMs ||
        left.createdAt - right.createdAt;
    }).map(function (entry, index) {
      return Object.assign({}, entry, { rank: index + 1 });
    });
  }

  function saveLeaderboard() {
    try {
      window.localStorage.setItem(LEADERBOARD_KEY, JSON.stringify(state.leaderboard));
    } catch {
      // The game stays playable if private browsing blocks device storage.
    }
  }

  function savePreferences() {
    try {
      window.localStorage.setItem("ai-impostor-language", state.language);
      window.localStorage.setItem("ai-impostor-sound", String(state.soundEnabled));
      window.localStorage.setItem("ai-impostor-music-volume", String(state.musicVolume));
    } catch {
      // Preferences remain active for this session if device storage is unavailable.
    }
  }

  function robotMark(compact) {
    return '<span class="robot-mark' + (compact ? " robot-mark--compact" : "") + '" aria-hidden="true">' +
      '<span class="robot-mark__antenna"></span><span class="robot-mark__face">' +
      '<span class="robot-mark__eye"></span><span class="robot-mark__eye"></span></span></span>';
  }

  function categoryIcon(category) {
    var option = categories.find(function (item) { return item.name === category; });
    return option ? option.icon : "◆";
  }

  function currentQuestion() {
    return state.rounds[state.roundIndex];
  }

  function currentFormat() {
    var question = currentQuestion();
    return question ? formatMeta[question.format] : null;
  }

  function averageResponseTime() {
    if (!state.responseTimes.length) return "0.0";
    return (state.responseTimes.reduce(function (sum, value) { return sum + value; }, 0) / state.responseTimes.length).toFixed(1);
  }

  function utilityControls() {
    return '<div class="utility-controls">' +
      '<div class="audio-settings"><button class="sound-toggle' + (state.soundEnabled ? " sound-toggle--active" : "") + '" type="button" data-action="sound" aria-label="' +
      escapeHtml(state.soundEnabled ? t("muteSounds") : t("enableSounds")) + '" aria-pressed="' + state.soundEnabled + '">' +
      (state.soundEnabled ? "🔊" : "🔇") + '</button>' +
      '<label class="music-volume" title="' + escapeHtml(t("musicVolume")) + '"><span aria-hidden="true">🎵</span>' +
      '<input id="music-volume" type="range" min="0" max="100" step="1" value="' + Math.round(state.musicVolume * 100) + '" aria-label="' + escapeHtml(t("musicVolume")) + '"' + (state.soundEnabled ? "" : " disabled") + '>' +
      '<b>' + Math.round(state.musicVolume * 100) + '%</b></label></div>' +
      '<div class="language-switch" role="group" aria-label="' + escapeHtml(t("language")) + '">' +
      '<button type="button" class="' + (state.language === "en" ? "language-switch__active" : "") + '" data-language="en" aria-pressed="' + (state.language === "en") + '">EN</button>' +
      '<button type="button" class="' + (state.language === "ms" ? "language-switch__active" : "") + '" data-language="ms" aria-pressed="' + (state.language === "ms") + '">BM</button></div>' +
      '<button class="booth-toggle' + (state.boothMode ? " booth-toggle--active" : "") + '" type="button" data-action="booth" aria-pressed="' + state.boothMode + '">' +
      '<span class="booth-toggle__dot"></span> ' + escapeHtml(t("boothMode")) + '</button></div>';
  }

  function renderHome() {
    var champion = state.leaderboard[0];
    return '<section class="screen screen--home" aria-labelledby="home-title">' +
      '<div class="home-orbit" aria-hidden="true"><span class="home-orbit__ring home-orbit__ring--one"></span>' +
      '<span class="home-orbit__ring home-orbit__ring--two"></span><span class="home-orbit__spark home-orbit__spark--one">◆</span>' +
      '<span class="home-orbit__spark home-orbit__spark--two">+</span>' + robotMark(false) + '</div>' +
      '<p class="eyebrow"><span></span> ' + escapeHtml(t("smartLive")) + ' <span></span></p>' +
      '<h1 id="home-title" class="hero-title"><span>AI</span> IMPOSTOR</h1>' +
      '<p class="hero-subtitle">' + escapeHtml(t("deviceHeroSubtitle")) + '</p>' +
      '<div class="home-actions"><button class="button button--primary button--hero" type="button" data-action="setup">' + escapeHtml(t("playNow")) + ' <span>⚡</span></button>' +
      '<button class="button button--rank button--hero" type="button" data-action="ranking">' + escapeHtml(t("deviceRanking")) + ' <span>🏆</span></button>' +
      '<button class="button button--ghost button--hero" type="button" data-action="how">' + escapeHtml(t("howToPlay")) + ' <span>?</span></button></div>' +
      '<button class="high-score-card high-score-card--button" type="button" data-action="ranking">' +
      '<span class="high-score-card__icon">👑</span><span class="high-score-card__label">' + escapeHtml(t("currentChampion")) + '</span>' +
      '<span class="high-score-card__name">' + escapeHtml(champion ? champion.nickname : t("firstChampion")) + '</span>' +
      '<strong>' + formatNumber(champion ? champion.score : 0) + '</strong></button>' +
      '<div class="home-feature-strip" aria-label="' + escapeHtml(t("gameFeatures")) + '"><span>🧠 ' + escapeHtml(t("adaptiveDifficulty")) + '</span>' +
      '<span>🤖 ' + escapeHtml(t("reactiveHost")) + '</span><span>🪪 ' + escapeHtml(t("personalProfile")) + '</span></div>' +
      '<p class="team-credit">' + escapeHtml(t("createdBy")) + ' · ' + escapeHtml(t("offlineEdition")) + '</p></section>';
  }

  function renderSetup() {
    var categoryCards = categories.map(function (option) {
      var selected = state.category === option.name;
      return '<button type="button" class="choice-card' + (selected ? " choice-card--selected" : "") + '" data-category="' + option.name + '" aria-pressed="' + selected + '">' +
        '<span class="choice-card__icon">' + option.icon + '</span><span class="choice-card__copy"><strong>' + escapeHtml(localize(option.label)) + '</strong><small>' + escapeHtml(localize(option.description)) + '</small></span>' +
        '<span class="choice-card__check">✓</span></button>';
    }).join("");

    var difficultyCards = difficulties.map(function (option) {
      var selected = state.difficulty === option.name;
      return '<button type="button" class="difficulty-card difficulty-card--' + option.name.toLowerCase() + (selected ? " difficulty-card--selected" : "") + '" data-difficulty="' + option.name + '" aria-pressed="' + selected + '">' +
        '<span>' + option.icon + '</span><strong>' + escapeHtml(localize(option.label)) + '</strong><small>' + escapeHtml(localize(option.description)) + '</small><b>' + option.multiplier + '</b></button>';
    }).join("");

    var modeDetail = state.challengeMode === "smart"
      ? '<div class="adaptive-preview" aria-label="' + escapeHtml(t("smartDescription")) + '"><span><b>01</b> ' + escapeHtml(t("mediumCalibration")) + '</span><i>→</i><span><b>02</b> ' + escapeHtml(t("performanceScan")) + '</span><i>→</i><span><b>03</b> ' + escapeHtml(t("adaptiveNext")) + '</span></div>'
      : '<div class="classic-level-picker"><p>' + escapeHtml(t("choosePractice")) + '</p><div class="difficulty-grid">' + difficultyCards + '</div></div>';

    return '<section class="screen screen--setup" aria-labelledby="setup-title"><header class="compact-header">' +
      '<button class="icon-button" type="button" data-action="home" aria-label="' + escapeHtml(t("returnHome")) + '">←</button>' +
      '<div class="brand-lockup">' + robotMark(true) + '<span><strong>AI</strong> IMPOSTOR</span></div>' +
      '<button class="help-button" type="button" data-action="how">' + escapeHtml(t("howToPlay")) + '</button></header>' +
      '<div class="setup-heading"><p class="step-kicker">' + escapeHtml(t("joinChallenge")) + '</p><h2 id="setup-title">' + escapeHtml(t("createCard")) + '</h2>' +
      '<p>' + escapeHtml(t("setupIntro")) + '</p></div>' +
      '<div class="setup-panel"><div class="player-identity' + (state.nicknameError ? " player-identity--error" : "") + '">' +
      '<label for="player-name"><span>01 · ' + escapeHtml(t("nickname")) + '</span><small>' + escapeHtml(t("required")) + '</small></label>' +
      '<input id="player-name" type="text" value="' + escapeHtml(state.nickname) + '" minlength="2" maxlength="18" placeholder="' + escapeHtml(t("nicknamePlaceholder")) + '" autocomplete="off" aria-invalid="' + Boolean(state.nicknameError) + '" aria-describedby="nickname-help">' +
      '<p id="nickname-help">' + escapeHtml(state.nicknameError || t("deviceNicknameHelp")) + '</p></div>' +
      '<fieldset class="choice-section"><legend><span>02</span> ' + escapeHtml(t("chooseArena")) + '</legend><div class="category-grid">' + categoryCards + '</div></fieldset>' +
      '<fieldset class="choice-section choice-section--mode"><legend><span>03</span> ' + escapeHtml(t("chooseChallenge")) + '</legend>' +
      '<div class="challenge-mode-grid"><button type="button" class="challenge-mode-card challenge-mode-card--smart' + (state.challengeMode === "smart" ? " challenge-mode-card--selected" : "") + '" data-mode="smart" aria-pressed="' + (state.challengeMode === "smart") + '">' +
      '<span class="mode-ribbon">' + escapeHtml(t("recommended")) + '</span><span class="challenge-mode-card__icon">🧠</span><span class="challenge-mode-card__copy"><strong>' + escapeHtml(t("smartChallenge")) + '</strong><small>' + escapeHtml(t("smartDescription")) + '</small></span>' +
      '<span class="challenge-mode-card__reward">' + escapeHtml(t("smartReward")) + '</span><span class="choice-card__check">✓</span></button>' +
      '<button type="button" class="challenge-mode-card challenge-mode-card--classic' + (state.challengeMode === "classic" ? " challenge-mode-card--selected" : "") + '" data-mode="classic" aria-pressed="' + (state.challengeMode === "classic") + '">' +
      '<span class="challenge-mode-card__icon">🎮</span><span class="challenge-mode-card__copy"><strong>' + escapeHtml(t("chooseDifficulty")) + '</strong><small>' + escapeHtml(t("classicDescription")) + '</small></span>' +
      '<span class="challenge-mode-card__reward">' + escapeHtml(t("classicReward")) + '</span><span class="choice-card__check">✓</span></button></div>' +
      modeDetail + '</fieldset>' +
      '<button class="button button--primary start-challenge" type="button" data-action="start">' +
      escapeHtml(state.challengeMode === "smart" ? t("startSmart") : fill(t("startPractice"), { difficulty: difficultyLabel(state.difficulty) })) + ' <span>🚀</span></button></div></section>';
  }

  function renderTutorial() {
    var exampleQuestion = state.language === "en"
      ? 'Find the one that is <mark>NOT</mark> a fruit.'
      : 'Cari satu yang <mark>BUKAN</mark> buah.';
    var formatCards = ["impostor", "squad", "fake-fact"].map(function (format) {
      return '<div><span>' + formatMeta[format].icon + '</span><strong>' + escapeHtml(localize(formatMeta[format].kicker)) + '</strong></div>';
    }).join("");

    return '<section class="screen screen--tutorial" aria-labelledby="tutorial-title"><header class="compact-header">' +
      '<button class="icon-button" type="button" data-action="setup" aria-label="' + escapeHtml(t("returnHome")) + '">←</button>' +
      '<div class="brand-lockup">' + robotMark(true) + '<span><strong>AI</strong> IMPOSTOR</span></div><span aria-hidden="true"></span></header>' +
      '<div class="tutorial-panel"><div class="tutorial-heading"><p class="step-kicker">' + escapeHtml(t("tutorialKicker")) + '</p>' +
      '<h2 id="tutorial-title">' + escapeHtml(t("tutorialTitle")) + '</h2><p>' + escapeHtml(t("tutorialIntro")) + '</p></div>' +
      '<div class="tutorial-timeline" aria-label="' + escapeHtml(t("readTimeText") + "; " + t("answerTimeText")) + '">' +
      '<div class="tutorial-phase tutorial-phase--read"><span>👀</span><b>5</b><strong>' + escapeHtml(t("readPhase")) + '</strong><small>' + escapeHtml(t("readTimeText")) + '</small></div><i aria-hidden="true">→</i>' +
      '<div class="tutorial-phase tutorial-phase--answer"><span>⚡</span><b>10</b><strong>' + escapeHtml(t("answerPhase")) + '</strong><small>' + escapeHtml(t("answerTimeText")) + '</small></div></div>' +
      '<div class="tutorial-example"><p>' + escapeHtml(t("example")) + '</p><h3>' + exampleQuestion + '</h3><div class="example-options">' +
      '<span>🍎 ' + escapeHtml(t("exampleApple")) + '</span><span>🍌 ' + escapeHtml(t("exampleBanana")) + '</span><span>🍊 ' + escapeHtml(t("exampleOrange")) + '</span>' +
      '<span class="example-option--answer">🚲 ' + escapeHtml(t("exampleBicycle")) + '<b>✓ ' + escapeHtml(t("exampleCorrect")) + '</b></span></div></div>' +
      '<div class="tutorial-format-grid">' + formatCards + '</div><button class="button button--primary tutorial-ready" type="button" data-action="tutorial-ready">' + escapeHtml(t("readyButton")) + ' <span aria-hidden="true">⚡</span></button></div></section>';
  }

  function renderCountdown() {
    var value = state.countdownValue === 0 ? t("go") : state.countdownValue;
    return '<section class="screen screen--countdown" aria-live="assertive" aria-atomic="true"><div class="countdown-card">' + robotMark(false) +
      '<p>' + escapeHtml(fill(t("getReady"), { nickname: state.nickname })) + '</p><strong class="countdown-number' + (state.countdownValue === 0 ? " countdown-number--go" : "") + '">' + escapeHtml(value) + '</strong>' +
      '<small>' + escapeHtml(t("firstQuestionComing")) + '</small></div></section>';
  }

  function renderAnswerCard(item, index, question) {
    var isCorrectAnswer = index === question.answer;
    var isSelected = index === state.selectedIndex;
    var feedbackClass = state.outcome
      ? isCorrectAnswer ? " answer-card--correct" : isSelected ? " answer-card--wrong" : " answer-card--dimmed"
      : "";
    var isLocked = state.roundPhase === "reading" && !state.outcome;
    var indicator = state.outcome && isCorrectAnswer ? "✓" : state.outcome && isSelected ? "×" : isLocked ? "🔒" : "↗";
    return '<button class="answer-card' + (isLocked ? " answer-card--locked" : "") + feedbackClass + '" type="button" data-answer="' + index + '"' + (state.outcome || isLocked ? " disabled" : "") + ' aria-label="' + escapeHtml(t("choice")) + ' ' + (index + 1) + ': ' + escapeHtml(localize(item.name)) + '">' +
      '<span class="answer-card__number">' + (index + 1) + '</span><span class="answer-card__emoji" aria-hidden="true">' + item.emoji + '</span>' +
      '<strong>' + escapeHtml(localize(item.name)) + '</strong><span class="answer-card__indicator" aria-hidden="true">' + indicator + '</span></button>';
  }

  function renderHost(question) {
    var nextLabel = state.outcome ? t("nextLevel") : state.roundIndex === 0 ? t("startingLevel") : t("currentLevel");
    var nextValue = state.outcome ? state.nextAdaptiveDifficulty : question.difficulty;
    return '<div class="host-panel host-panel--' + state.hostReaction.tone + '" aria-live="polite">' +
      '<span class="host-panel__avatar">' + robotMark(true) + '<i></i></span><span class="host-panel__copy">' +
      '<small>' + escapeHtml(localize(state.hostReaction.label)) + '</small><strong>' + escapeHtml(localize(state.hostReaction.headline)) + '</strong><p>' + escapeHtml(localize(state.hostReaction.message)) + '</p></span>' +
      (state.challengeMode === "smart" ? '<span class="host-panel__status"><small>' + escapeHtml(nextLabel) + '</small><b>' + escapeHtml(difficultyLabel(nextValue)) + '</b></span>' : "") + '</div>';
  }

  function renderFeedback(question) {
    if (!state.outcome) return "";
    var signal = state.outcome === "correct" ? "✓" : state.outcome === "wrong" ? "×" : "⏱";
    var heading = state.outcome === "correct"
      ? t("patternCracked")
      : fill(t("correctAnswer"), { answer: localize(question.items[question.answer].name) });
    var breakdown = "";
    if (state.scoreBreakdown) {
      breakdown = '<div class="score-burst"><strong>+' + formatNumber(state.scoreBreakdown.total) + '</strong><div>' +
        '<span>' + escapeHtml(t("base")) + ' ' + state.scoreBreakdown.base + '</span><span>' + escapeHtml(t("speed")) + ' +' + state.scoreBreakdown.speed + '</span>' +
        (state.scoreBreakdown.quick > 0 ? '<span>⚡ ' + escapeHtml(t("quick")) + ' +' + state.scoreBreakdown.quick + '</span>' : "") +
        (state.scoreBreakdown.streak > 0 ? '<span>🔥 ' + escapeHtml(t("streak")) + ' +' + state.scoreBreakdown.streak + '</span>' : "") +
        (state.scoreBreakdown.smart > 0 ? '<span>🧠 ' + escapeHtml(t("smartChallenge")) + ' +' + state.scoreBreakdown.smart + '</span>' : "") +
        '<span>×' + state.scoreBreakdown.multiplier.toFixed(2) + '</span></div></div>';
    }
    var advanceText = fill(t("inSeconds"), {
      seconds: 3,
    });
    return '<div class="feedback feedback--' + state.outcome + '" aria-live="polite">' +
      (state.outcome === "correct" ? '<div class="confetti" aria-hidden="true">' + Array.from({ length: 12 }, function (_, index) { return '<i style="--i:' + index + '"></i>'; }).join("") + '</div>' : "") +
      '<div class="feedback__signal" aria-hidden="true">' + signal + '</div><div class="feedback__copy"><p><i class="analysis-dot"></i> ' + escapeHtml(t("patternExplanation")) + '</p>' +
      '<h3>' + escapeHtml(heading) + '</h3><span>' + escapeHtml(localize(question.explanation)) + '</span></div>' + breakdown +
      '<div class="auto-advance"><span id="advance-label">' + escapeHtml(state.roundIndex === TOTAL_ROUNDS - 1 ? t("results") : t("nextQuestion")) + ' ' + escapeHtml(advanceText) + '</span><i><b id="advance-progress" style="width:0%"></b></i></div></div>';
  }

  function renderGame() {
    var question = currentQuestion();
    var format = currentFormat();
    if (!question || !format) return "";
    var timerLimit = state.roundPhase === "reading" ? READ_SECONDS : ANSWER_SECONDS;
    var timerTone = state.roundPhase === "reading" ? "reading" : state.timeLeft <= 3 ? "danger" : state.timeLeft <= 6 ? "warning" : "safe";
    var timerPercent = Math.max(0, Math.min(100, state.timeLeft / timerLimit * 100));
    var answers = question.items.map(function (item, index) {
      return renderAnswerCard(item, index, question);
    }).join("");

    return '<section class="screen screen--game" aria-labelledby="question-title"><header class="game-header">' +
      '<div class="brand-lockup">' + robotMark(true) + '<span><strong>AI</strong> IMPOSTOR</span></div>' +
      '<div class="round-counter"><span>' + escapeHtml(t("round")) + '</span><strong>' + (state.roundIndex + 1) + '</strong><span>/ ' + TOTAL_ROUNDS + '</span></div>' +
      '<div class="game-score-stack">' + (state.streak > 1 ? '<span class="streak-pill">🔥 ' + state.streak + ' ' + escapeHtml(t("streak")) + '</span>' : "") +
      '<div class="score-counter"><span>' + escapeHtml(t("score")) + '</span><strong>' + formatNumber(state.score) + '</strong></div></div></header>' +
      '<div class="game-stage game-stage--' + question.format + '"><div class="game-meta"><span>' + categoryIcon(question.category) + ' ' + escapeHtml(categoryLabel(question.category)) + '</span>' +
      '<span class="format-pill">' + format.icon + ' ' + escapeHtml(localize(format.label)) + '</span><span class="challenge-pill challenge-pill--' + state.challengeMode + '">' +
      (state.challengeMode === "smart" ? "🧠 " + escapeHtml(t("smartChallenge")) : "🎮 " + escapeHtml(t("chosenDifficulty"))) + '</span>' +
      '<span class="difficulty-pill difficulty-pill--' + question.difficulty.toLowerCase() + '">' + escapeHtml(difficultyLabel(question.difficulty)) + '</span></div>' +
      renderHost(question) + '<div class="question-row"><div><p class="question-kicker">' + format.icon + ' ' + escapeHtml(localize(format.kicker)) + '</p><h2 id="question-title">' + highlightedQuestion(question) + '</h2></div>' +
      '<div class="timer timer--' + timerTone + '" style="--timer:' + timerPercent + '%"><span class="timer__label">' + escapeHtml(state.roundPhase === "reading" ? t("readPhase") : t("answerPhase")) + '</span><strong>' + Math.ceil(state.timeLeft) + '</strong><span class="timer__unit">' + escapeHtml(t("secondsShort")) + '</span></div></div>' +
      '<div class="timer-track" aria-hidden="true"><span style="width:' + timerPercent + '%"></span></div>' +
      (!state.outcome ? '<p class="phase-notice phase-notice--' + state.roundPhase + '" aria-live="polite"><span aria-hidden="true">' + (state.roundPhase === "reading" ? "👀" : "⚡") + '</span>' + escapeHtml(state.roundPhase === "reading" ? fill(t("readHint"), { seconds: Math.ceil(state.timeLeft) }) : fill(t("answerHint"), { keys: "1–" + question.items.length })) + '</p>' : "") +
      '<div class="answers-grid answers-grid--' + question.format + '" role="group" aria-label="' + escapeHtml(t("answerChoices")) + '">' + answers + '</div>' +
      (!state.outcome && state.roundPhase === "reading" ? '<p class="tap-hint">🔒 ' + escapeHtml(t("answersLocked")) + '</p>' : "") +
      (!state.outcome && state.roundPhase === "answering" ? '<p class="tap-hint">' + escapeHtml(fill(t("tapHint"), { keys: "1–" + question.items.length })) + '</p>' : "") +
      renderFeedback(question) + '</div></section>';
  }

  function renderProfile(profile) {
    var traits = profile.traits.map(function (trait) { return '<span>' + escapeHtml(localize(trait)) + '</span>'; }).join("");
    var journey = "";
    if (state.challengeMode === "smart") {
      journey = '<div class="difficulty-journey"><small>' + escapeHtml(t("adaptiveJourney")) + '</small><div>' + state.roundHistory.map(function (record, index) {
        var level = difficultyLabel(record.difficulty);
        return '<span class="journey-step journey-step--' + record.difficulty.toLowerCase() + (record.correct ? " journey-step--won" : "") + '" title="' + escapeHtml(t("round")) + ' ' + (index + 1) + ': ' + escapeHtml(level) + ' · ' + escapeHtml(record.correct ? t("correct") : t("missed")) + '"><i>' + (index + 1) + '</i>' + escapeHtml(level.charAt(0)) + '</span>';
      }).join("") + '</div></div>';
    }
    return '<section class="player-profile" aria-labelledby="player-profile-title"><div class="player-profile__icon" aria-hidden="true">' + profile.icon + '</div>' +
      '<div class="player-profile__copy"><span>' + escapeHtml(t("novaAnalysis")) + '</span><h3 id="player-profile-title">' + escapeHtml(localize(profile.title)) + '</h3><strong>' + escapeHtml(localize(profile.tagline)) + '</strong><p>' + escapeHtml(localize(profile.description)) + '</p></div>' +
      '<div class="player-profile__traits">' + traits + '</div>' + journey + '</section>';
  }

  function leaderboardRows(entries, limit) {
    var rows = typeof limit === "number" ? entries.slice(0, limit) : entries;
    return rows.map(function (entry) {
      return '<li class="' + (entry.id === state.savedEntryId ? "leaderboard__current" : "") + '"><span class="leaderboard__rank">' + entry.rank + '</span>' +
        '<strong>' + escapeHtml(entry.nickname) + '</strong><small>' + escapeHtml(categoryLabel(entry.category)) + ' · ' + (entry.difficulty === "Smart Challenge" ? "🧠 " : "") + escapeHtml(difficultyLabel(entry.difficulty)) + ' · ' + entry.correctAnswers + '/' + entry.totalQuestions + ' ' + escapeHtml(t("correctShort")) + ' · ' + (entry.averageResponseMs / 1000).toFixed(1) + escapeHtml(t("secondsShort")) + ' ' + escapeHtml(t("averageShort")) + ' · 🔥 ' + entry.bestStreak + '</small>' +
        '<b>' + formatNumber(entry.score) + '</b></li>';
    }).join("");
  }

  function renderResult() {
    var profile = buildPlayerProfile(state.roundHistory, state.bestStreak);
    return '<section class="screen screen--result" aria-labelledby="result-title"><div class="result-burst" aria-hidden="true"><span>✦</span><span>◆</span><span>✦</span><span>+</span></div>' +
      '<div class="result-icon">' + robotMark(false) + '</div><p class="eyebrow"><span></span> ' + escapeHtml(t("challengeComplete")) + ' <span></span></p>' +
      '<h2 id="result-title">' + escapeHtml(fill(t("profileReady"), { nickname: state.nickname })) + '</h2><p class="result-subtitle">' + escapeHtml(t("deviceProfileSubtitle")) + '</p>' +
      (state.playerRank === 1 ? '<div class="new-high-score">👑 ' + escapeHtml(t("deviceChampion")) + '</div>' : '<div class="new-high-score new-high-score--rank">🏆 ' + escapeHtml(fill(t("deviceRank"), { rank: state.playerRank })) + '</div>') +
      renderProfile(profile) + '<div class="final-score"><span>' + escapeHtml(t("finalScore")) + '</span><strong>' + formatNumber(state.score) + '</strong><small>' + escapeHtml(t("scoreFormula")) + (state.challengeMode === "smart" ? escapeHtml(t("smartBonus")) : "") + '</small></div>' +
      '<div class="result-stats"><div><span>🎯</span><p>' + escapeHtml(t("correctAnswers")) + '</p><strong>' + state.correctCount + ' <small>/ ' + TOTAL_ROUNDS + '</small></strong></div>' +
      '<div><span>⏱</span><p>' + escapeHtml(t("averageResponse")) + '</p><strong>' + averageResponseTime() + ' <small>' + escapeHtml(t("seconds")) + '</small></strong></div>' +
      '<div><span>🔥</span><p>' + escapeHtml(t("bestStreak")) + '</p><strong>' + state.bestStreak + ' <small>' + escapeHtml(t("inARow")) + '</small></strong></div></div>' +
      '<section class="leaderboard leaderboard--preview" aria-labelledby="result-leaderboard-title"><header><div><span>💻</span><h3 id="result-leaderboard-title">' + escapeHtml(t("deviceTop")) + '</h3></div><p>' + escapeHtml(fill(t("totalAttempts"), { count: state.leaderboard.length })) + '</p></header><ol>' + leaderboardRows(state.leaderboard, 5) + '</ol></section>' +
      '<div class="result-actions"><button class="button button--rank" type="button" data-action="ranking">' + escapeHtml(t("viewEveryRanking")) + ' <span>→</span></button>' +
      '<button class="text-button" type="button" data-action="home">' + escapeHtml(t("returnHome")) + '</button></div></section>';
  }

  function filteredLeaderboard() {
    var query = state.leaderboardQuery.trim().toLocaleLowerCase();
    if (!query) return state.leaderboard;
    return state.leaderboard.filter(function (entry) {
      return entry.nickname.toLocaleLowerCase().includes(query);
    });
  }

  function renderLeaderboard() {
    var filtered = filteredLeaderboard();
    return '<section class="screen screen--leaderboard" aria-labelledby="device-ranking-title"><header class="compact-header">' +
      '<button class="icon-button" type="button" data-action="home" aria-label="' + escapeHtml(t("returnHome")) + '">←</button><div class="brand-lockup">' + robotMark(true) + '<span><strong>AI</strong> IMPOSTOR</span></div>' +
      '<button class="help-button" type="button" data-action="setup">' + escapeHtml(t("play")) + '</button></header><div class="leaderboard-heading"><p class="step-kicker">' + escapeHtml(t("legendsHall")) + '</p>' +
      '<h2 id="device-ranking-title">' + escapeHtml(t("deviceRanking")) + '</h2><p>' + escapeHtml(t("deviceRankingIntro")) + '</p></div>' +
      '<div class="ranking-toolbar"><label for="ranking-search">🔎 <span>' + escapeHtml(t("findNickname")) + '</span></label><input id="ranking-search" type="search" value="' + escapeHtml(state.leaderboardQuery) + '" placeholder="' + escapeHtml(t("searchPlayers")) + '"><b id="ranking-count">' + escapeHtml(resultCount(filtered.length)) + '</b></div>' +
      (state.leaderboardNotice ? '<div class="leaderboard-notice" role="status">✓ ' + escapeHtml(state.leaderboardNotice) + '</div>' : "") +
      '<section class="leaderboard leaderboard--full" aria-label="' + escapeHtml(t("allDeviceRankings")) + '"><ol id="ranking-results">' + leaderboardRows(filtered) + '</ol>' +
      (filtered.length ? "" : '<div class="ranking-empty">' + escapeHtml(t("noNickname")) + '</div>') + '</section>' +
      '<div class="leaderboard-actions"><button class="button button--primary" type="button" data-action="setup">' + escapeHtml(t("challengeRanking")) + ' <span>⚡</span></button>' +
      '<button class="button button--danger" type="button" data-action="open-clear"' + (state.leaderboard.length ? "" : " disabled") + '>' + escapeHtml(t("clearLeaderboard")) + ' <span>🗑️</span></button></div></section>';
  }

  function renderHowTo() {
    if (!state.showHowTo) return "";
    return '<div class="modal-backdrop" role="presentation" data-action="backdrop"><section class="how-modal" role="dialog" aria-modal="true" aria-labelledby="how-title">' +
      '<button class="modal-close" type="button" data-action="close-how" aria-label="' + escapeHtml(t("closeInstructions")) + '">×</button><div class="modal-icon">' + robotMark(true) + '</div>' +
      '<p class="step-kicker">' + escapeHtml(t("missionBriefing")) + '</p><h2 id="how-title">' + escapeHtml(t("chooseYourChallenge")) + '</h2><p class="modal-intro">' + escapeHtml(t("modalIntro")) + '</p>' +
      '<div class="challenge-guide"><div><span>🧠</span><strong>' + escapeHtml(t("smartChallenge")) + '</strong><p>' + escapeHtml(t("smartGuide")) + '</p></div>' +
      '<div><span>🎮</span><strong>' + escapeHtml(t("chooseDifficulty")) + '</strong><p>' + escapeHtml(t("classicGuide")) + '</p></div></div>' +
      '<p class="guide-label">' + escapeHtml(t("threeFormats")) + '</p><div class="mode-guide"><div><span>🕵️</span><strong>' + escapeHtml(localize(formatMeta.impostor.label)) + '</strong><p>' + escapeHtml(t("impostorGuide")) + '</p></div>' +
      '<div><span>🧩</span><strong>' + escapeHtml(localize(formatMeta.squad.label)) + '</strong><p>' + escapeHtml(t("squadGuide")) + '</p></div><div><span>🎭</span><strong>' + escapeHtml(localize(formatMeta["fake-fact"].label)) + '</strong><p>' + escapeHtml(t("fakeGuide")) + '</p></div></div>' +
      '<ol class="instruction-list"><li><span>01</span><div><strong>' + escapeHtml(t("beatTimer")) + '</strong><p>' + escapeHtml(t("beatTimerText")) + '</p></div></li>' +
      '<li><span>02</span><div><strong>' + escapeHtml(t("listenNova")) + '</strong><p>' + escapeHtml(t("listenNovaText")) + '</p></div></li>' +
      '<li><span>03</span><div><strong>' + escapeHtml(t("watchReveal")) + '</strong><p>' + escapeHtml(t("watchRevealText")) + '</p></div></li>' +
      '<li><span>04</span><div><strong>' + escapeHtml(t("revealProfile")) + '</strong><p>' + escapeHtml(t("deviceProfileGuide")) + '</p></div></li></ol>' +
      '<button class="button button--primary modal-action" type="button" data-action="close-how">' + escapeHtml(t("letsPlay")) + ' <span>🚀</span></button></section></div>';
  }

  function renderClearLeaderboard() {
    if (!state.showClearLeaderboard) return "";
    return '<div class="modal-backdrop" role="presentation" data-action="clear-backdrop"><section class="how-modal confirm-modal" role="alertdialog" aria-modal="true" aria-labelledby="clear-leaderboard-title" aria-describedby="clear-leaderboard-warning">' +
      '<button class="modal-close" type="button" data-action="close-clear" aria-label="' + escapeHtml(t("cancel")) + '">×</button>' +
      '<div class="confirm-modal__icon" aria-hidden="true">🗑️</div><p class="step-kicker">' + escapeHtml(t("adminControl")) + '</p>' +
      '<h2 id="clear-leaderboard-title">' + escapeHtml(t("clearLeaderboardTitle")) + '</h2>' +
      '<p class="modal-intro" id="clear-leaderboard-warning">' + escapeHtml(fill(t("deviceClearLeaderboardWarning"), { count: state.leaderboard.length })) + '</p>' +
      '<div class="confirm-modal__actions"><button class="button button--ghost" type="button" data-action="close-clear">' + escapeHtml(t("cancel")) + '</button>' +
      '<button class="button button--danger" type="button" data-action="confirm-clear">' + escapeHtml(t("clearLeaderboardConfirm")) + '</button></div></section></div>';
  }

  function render() {
    stopRoundTimer();
    stopFeedbackTimer();
    document.documentElement.lang = state.language;
    app.className = "app-shell app-shell--" + state.screen;
    var question = currentQuestion();
    app.setAttribute("data-category", question ? question.category.toLowerCase() : "random");

    var content = state.screen === "home" ? renderHome()
      : state.screen === "setup" ? renderSetup()
        : state.screen === "tutorial" ? renderTutorial()
          : state.screen === "countdown" ? renderCountdown()
            : state.screen === "game" ? renderGame()
              : state.screen === "result" ? renderResult()
                : renderLeaderboard();

    app.innerHTML = '<div class="ambient ambient--one"></div><div class="ambient ambient--two"></div><div class="grid-overlay"></div>' +
      utilityControls() + content + renderHowTo() + renderClearLeaderboard();
    document.body.classList.toggle("booth-mode", state.boothMode);
    wireControls();
    syncAudio(state.soundEnabled, state.musicVolume, false);

    if (state.screen === "game" && !state.outcome) startRoundTimer();
    if (state.screen === "game" && state.outcome) startFeedbackTimer();
  }

  function wireControls() {
    app.querySelectorAll("[data-action]").forEach(function (button) {
      button.addEventListener("click", handleAction);
    });
    app.querySelectorAll("[data-category]").forEach(function (button) {
      button.addEventListener("click", function () {
        state.category = button.getAttribute("data-category");
        vibrate(7);
        render();
      });
    });
    app.querySelectorAll("[data-mode]").forEach(function (button) {
      button.addEventListener("click", function () {
        state.challengeMode = button.getAttribute("data-mode");
        vibrate(7);
        render();
      });
    });
    app.querySelectorAll("[data-difficulty]").forEach(function (button) {
      button.addEventListener("click", function () {
        state.difficulty = button.getAttribute("data-difficulty");
        vibrate(7);
        render();
      });
    });
    app.querySelectorAll("[data-answer]").forEach(function (button) {
      button.addEventListener("click", function () {
        selectAnswer(Number(button.getAttribute("data-answer")));
      });
    });
    app.querySelectorAll("[data-language]").forEach(function (button) {
      button.addEventListener("click", function () {
        state.language = button.getAttribute("data-language") === "ms" ? "ms" : "en";
        state.nicknameError = "";
        savePreferences();
        render();
      });
    });
    var musicInput = app.querySelector("#music-volume");
    if (musicInput) {
      musicInput.addEventListener("input", function () {
        state.musicVolume = Number(musicInput.value) / 100;
        var readout = musicInput.parentElement && musicInput.parentElement.querySelector("b");
        if (readout) readout.textContent = Math.round(state.musicVolume * 100) + "%";
        savePreferences();
        syncAudio(state.soundEnabled, state.musicVolume, true);
      });
    }
    var nameInput = app.querySelector("#player-name");
    if (nameInput) {
      nameInput.addEventListener("input", function () {
        state.nickname = nameInput.value;
        state.nicknameError = "";
      });
      nameInput.addEventListener("keydown", function (event) {
        if (event.key === "Enter") beginChallenge();
      });
    }
    var searchInput = app.querySelector("#ranking-search");
    if (searchInput) {
      searchInput.addEventListener("input", function () {
        state.leaderboardQuery = searchInput.value;
        updateLeaderboardSearch();
      });
    }
  }

  function handleAction(event) {
    var action = event.currentTarget.getAttribute("data-action");
    vibrate(7);
    if (action === "home") returnHome();
    else if (action === "setup") openSetup();
    else if (action === "ranking") {
      state.screen = "leaderboard";
      state.leaderboardQuery = "";
      render();
    } else if (action === "how") {
      state.showHowTo = true;
      render();
      window.setTimeout(function () {
        var closeButton = app.querySelector(".modal-close");
        if (closeButton) closeButton.focus();
      }, 0);
    } else if (action === "close-how") {
      state.showHowTo = false;
      render();
    } else if (action === "backdrop" && event.target === event.currentTarget) {
      state.showHowTo = false;
      render();
    } else if (action === "open-clear") {
      if (!state.leaderboard.length) {
        state.leaderboardNotice = t("clearLeaderboardEmpty");
        render();
        return;
      }
      state.showClearLeaderboard = true;
      render();
      window.setTimeout(function () {
        var confirmButton = app.querySelector('[data-action="confirm-clear"]');
        if (confirmButton) confirmButton.focus();
      }, 0);
    } else if (action === "close-clear") {
      state.showClearLeaderboard = false;
      render();
    } else if (action === "clear-backdrop" && event.target === event.currentTarget) {
      state.showClearLeaderboard = false;
      render();
    } else if (action === "confirm-clear") {
      clearDeviceLeaderboard();
    } else if (action === "start") beginChallenge();
    else if (action === "tutorial-ready") startReadyCountdown();
    else if (action === "booth") toggleBoothMode();
    else if (action === "sound") toggleSound();
  }

  function clearDeviceLeaderboard() {
    state.leaderboard = [];
    state.leaderboardQuery = "";
    state.playerRank = null;
    state.savedEntryId = null;
    state.showClearLeaderboard = false;
    state.leaderboardNotice = t("leaderboardCleared");
    try {
      window.localStorage.removeItem(LEADERBOARD_KEY);
    } catch {
      // The in-memory ranking is still cleared if device storage is unavailable.
    }
    render();
  }

  function beginChallenge() {
    var cleanNickname = state.nickname.trim().replace(/\s+/g, " ");
    if (cleanNickname.length < 2 || cleanNickname.length > 18) {
      state.nicknameError = t("nicknameError");
      state.screen = "setup";
      render();
      window.setTimeout(function () {
        var input = app.querySelector("#player-name");
        if (input) input.focus();
      }, 0);
      vibrate([35, 25, 35]);
      return;
    }

    var initialDifficulty = state.challengeMode === "smart" ? "Medium" : state.difficulty;
    var formatPlan = createFormatPlan();
    state.nickname = cleanNickname;
    state.nicknameError = "";
    state.roundFormatPlan = formatPlan;
    state.rounds = state.challengeMode === "smart"
      ? [chooseAdaptiveQuestion(state.category, initialDifficulty, new Set(), formatPlan[0])]
      : chooseRounds(questionBank.filter(function (question) {
        return question.difficulty === state.difficulty &&
          (state.category === "Random" || question.category === state.category);
      }), formatPlan);
    state.roundIndex = 0;
    state.score = 0;
    state.correctCount = 0;
    state.streak = 0;
    state.bestStreak = 0;
    state.selectedIndex = null;
    state.outcome = null;
    state.scoreBreakdown = null;
    state.responseTimes = [];
    state.roundHistory = [];
    state.nextAdaptiveDifficulty = initialDifficulty;
    state.hostReaction = roundIntro(cleanNickname, 1, state.challengeMode, initialDifficulty);
    state.feedbackProgress = 0;
    state.playerRank = null;
    state.savedEntryId = null;
    state.roundPhase = "reading";
    state.timeLeft = READ_SECONDS;
    state.screen = "tutorial";
    vibrate(18);
    render();
  }

  function selectAnswer(index) {
    var question = currentQuestion();
    if (state.outcome || !question || state.roundPhase !== "answering" || index < 0 || index >= question.items.length) return;
    var responseTime = Math.max(0, Math.min(ANSWER_SECONDS, (performance.now() - state.roundStartedAt) / 1000));
    var isCorrect = index === question.answer;
    var outcome = isCorrect ? "correct" : "wrong";
    var nextStreak = isCorrect ? state.streak + 1 : 0;
    var upcomingDifficulty = state.challengeMode === "smart"
      ? nextSmartDifficulty(question.difficulty, outcome, responseTime, nextStreak)
      : question.difficulty;

    stopRoundTimer();
    state.selectedIndex = index;
    state.responseTimes.push(responseTime);
    state.roundHistory.push({ correct: isCorrect, responseTime: responseTime, difficulty: question.difficulty, format: question.format });
    state.nextAdaptiveDifficulty = upcomingDifficulty;
    state.hostReaction = answerReaction({
      nickname: state.nickname,
      outcome: outcome,
      responseTime: responseTime,
      streak: nextStreak,
      currentDifficulty: question.difficulty,
      upcomingDifficulty: upcomingDifficulty,
      mode: state.challengeMode,
    });

    if (isCorrect) {
      var base = 400;
      var speed = Math.round(Math.max(0, ANSWER_SECONDS - responseTime) / ANSWER_SECONDS * 400);
      var quick = responseTime <= 2.5 ? 150 : 0;
      var streakBonus = Math.min(300, Math.max(0, nextStreak - 1) * 75);
      var multiplier = difficultyMultiplier[question.difficulty] * formatMultiplier[question.format];
      var subtotal = Math.round((base + speed + quick + streakBonus) * multiplier);
      var smart = state.challengeMode === "smart" ? Math.round(subtotal * (SMART_SCORE_MULTIPLIER - 1)) : 0;
      var total = subtotal + smart;
      state.scoreBreakdown = { base: base, speed: speed, quick: quick, streak: streakBonus, multiplier: multiplier, smart: smart, total: total };
      state.score += total;
      state.correctCount += 1;
      state.streak = nextStreak;
      state.bestStreak = Math.max(state.bestStreak, nextStreak);
      if (state.soundEnabled) playAnswerTone(true);
      vibrate([18, 28, 22]);
    } else {
      state.scoreBreakdown = null;
      state.streak = 0;
      if (state.soundEnabled) playAnswerTone(false);
      vibrate([70, 30, 35]);
    }
    state.outcome = outcome;
    state.feedbackProgress = 0;
    render();
  }

  function handleTimeout() {
    var question = currentQuestion();
    if (!question || state.outcome) return;
    var upcomingDifficulty = state.challengeMode === "smart"
      ? nextSmartDifficulty(question.difficulty, "timeout", ANSWER_SECONDS, 0)
      : question.difficulty;
    state.selectedIndex = null;
    state.scoreBreakdown = null;
    state.responseTimes.push(ANSWER_SECONDS);
    state.roundHistory.push({ correct: false, responseTime: ANSWER_SECONDS, difficulty: question.difficulty, format: question.format });
    state.nextAdaptiveDifficulty = upcomingDifficulty;
    state.hostReaction = answerReaction({
      nickname: state.nickname,
      outcome: "timeout",
      responseTime: ANSWER_SECONDS,
      streak: 0,
      currentDifficulty: question.difficulty,
      upcomingDifficulty: upcomingDifficulty,
      mode: state.challengeMode,
    });
    state.streak = 0;
    state.outcome = "timeout";
    state.feedbackProgress = 0;
    vibrate([60, 30, 60]);
    render();
  }

  function nextRound() {
    stopFeedbackTimer();
    if (state.roundIndex >= TOTAL_ROUNDS - 1) {
      completeChallenge();
      return;
    }
    if (state.challengeMode === "smart") {
      var used = new Set(state.rounds.map(function (question) { return question.familyId; }));
      var nextQuestion = chooseAdaptiveQuestion(state.category, state.nextAdaptiveDifficulty, used, state.roundFormatPlan[state.roundIndex + 1]);
      state.rounds.push(nextQuestion);
      state.hostReaction = roundIntro(state.nickname, state.roundIndex + 2, state.challengeMode, nextQuestion.difficulty);
    } else {
      var classicQuestion = state.rounds[state.roundIndex + 1];
      if (classicQuestion) state.hostReaction = roundIntro(state.nickname, state.roundIndex + 2, state.challengeMode, classicQuestion.difficulty);
    }
    state.roundIndex += 1;
    state.selectedIndex = null;
    state.outcome = null;
    state.scoreBreakdown = null;
    state.feedbackProgress = 0;
    state.roundPhase = "reading";
    state.timeLeft = READ_SECONDS;
    render();
  }

  function completeChallenge() {
    var averageResponseMs = state.responseTimes.length
      ? Math.round(state.responseTimes.reduce(function (sum, value) { return sum + value; }, 0) / state.responseTimes.length * 1000)
      : 0;
    var entry = {
      id: Date.now() * 1000 + Math.floor(Math.random() * 1000),
      nickname: state.nickname,
      score: state.score,
      correctAnswers: state.correctCount,
      totalQuestions: TOTAL_ROUNDS,
      averageResponseMs: averageResponseMs,
      bestStreak: state.bestStreak,
      category: state.category,
      difficulty: state.challengeMode === "smart" ? "Smart Challenge" : state.difficulty,
      createdAt: Date.now(),
    };
    state.leaderboardNotice = "";
    state.leaderboard = rankLeaderboard(state.leaderboard.concat(entry));
    state.savedEntryId = entry.id;
    var saved = state.leaderboard.find(function (item) { return item.id === entry.id; });
    state.playerRank = saved ? saved.rank : state.leaderboard.length;
    saveLeaderboard();
    state.screen = "result";
    render();
  }

  function updateLeaderboardSearch() {
    var filtered = filteredLeaderboard();
    var list = app.querySelector("#ranking-results");
    var count = app.querySelector("#ranking-count");
    if (list) list.innerHTML = leaderboardRows(filtered);
    if (count) count.textContent = resultCount(filtered.length);
  }

  function startRoundTimer() {
    stopRoundTimer();
    var phaseStartedAt = performance.now();
    var phaseSeconds = state.roundPhase === "reading" ? READ_SECONDS : ANSWER_SECONDS;
    if (state.roundPhase === "answering") state.roundStartedAt = phaseStartedAt;
    function tick(now) {
      state.timeLeft = Math.max(0, phaseSeconds - (now - phaseStartedAt) / 1000);
      updateTimerDisplay();
      if (state.timeLeft <= 0) {
        state.timerFrame = 0;
        if (state.roundPhase === "reading") {
          state.roundPhase = "answering";
          state.timeLeft = ANSWER_SECONDS;
          if (state.soundEnabled) playUnlockTone();
          vibrate(14);
          render();
          return;
        }
        handleTimeout();
        return;
      }
      state.timerFrame = window.requestAnimationFrame(tick);
    }
    state.timerFrame = window.requestAnimationFrame(tick);
  }

  function stopRoundTimer() {
    if (state.timerFrame) window.cancelAnimationFrame(state.timerFrame);
    state.timerFrame = 0;
  }

  function updateTimerDisplay() {
    var timer = app.querySelector(".timer");
    var track = app.querySelector(".timer-track span");
    if (!timer || !track) return;
    var timerLimit = state.roundPhase === "reading" ? READ_SECONDS : ANSWER_SECONDS;
    var percent = Math.max(0, Math.min(100, state.timeLeft / timerLimit * 100));
    var tone = state.roundPhase === "reading" ? "reading" : state.timeLeft <= 3 ? "danger" : state.timeLeft <= 6 ? "warning" : "safe";
    var number = timer.querySelector("strong");
    var label = timer.querySelector(".timer__label");
    var notice = app.querySelector(".phase-notice");
    timer.style.setProperty("--timer", percent + "%");
    timer.classList.remove("timer--reading", "timer--safe", "timer--warning", "timer--danger");
    timer.classList.add("timer--" + tone);
    track.style.width = percent + "%";
    if (number) number.textContent = String(Math.ceil(state.timeLeft));
    if (label) label.textContent = state.roundPhase === "reading" ? t("readPhase") : t("answerPhase");
    if (notice && state.roundPhase === "reading") notice.lastChild.textContent = fill(t("readHint"), { seconds: Math.ceil(state.timeLeft) });
  }

  function startFeedbackTimer() {
    stopFeedbackTimer();
    var startedAt = performance.now();
    function update(now) {
      var progress = Math.min(1, (now - startedAt) / FEEDBACK_DELAY_MS);
      var bar = app.querySelector("#advance-progress");
      var label = app.querySelector("#advance-label");
      if (bar) bar.style.width = progress * 100 + "%";
      if (label) {
        var remaining = Math.max(1, Math.ceil((1 - progress) * 3));
        label.textContent = (state.roundIndex === TOTAL_ROUNDS - 1 ? t("results") : t("nextQuestion")) + " " + fill(t("inSeconds"), { seconds: remaining });
      }
      if (progress < 1) state.feedbackFrame = window.requestAnimationFrame(update);
    }
    state.feedbackFrame = window.requestAnimationFrame(update);
    state.advanceTimer = window.setTimeout(nextRound, FEEDBACK_DELAY_MS);
  }

  function stopFeedbackTimer() {
    if (state.feedbackFrame) window.cancelAnimationFrame(state.feedbackFrame);
    if (state.advanceTimer) window.clearTimeout(state.advanceTimer);
    state.feedbackFrame = 0;
    state.advanceTimer = 0;
  }

  var audioEngine = null;
  var upbeatLeadPattern = [523.25, 659.25, 783.99, 659.25, 587.33, 698.46, 880, 698.46, 659.25, 783.99, 1046.5, 783.99, 587.33, 698.46, 880, 987.77];
  var upbeatBassPattern = [130.81, 146.83, 164.81, 146.83];
  var MUSIC_STEP_MS = 165;
  var MUSIC_OUTPUT_GAIN = 0.85;

  function ensureAudioEngine() {
    if (!window.AudioContext) return null;
    if (audioEngine) {
      audioEngine.context.resume().catch(function () {});
      return audioEngine;
    }

    var context = new window.AudioContext();
    var master = context.createGain();
    var music = context.createGain();
    var effects = context.createGain();
    master.gain.value = 1;
    music.gain.value = MUSIC_OUTPUT_GAIN * 0.35;
    effects.gain.value = 0.45;
    music.connect(master);
    effects.connect(master);
    master.connect(context.destination);
    audioEngine = { context: context, master: master, music: music, effects: effects, musicTimer: null, musicStep: 0 };
    return audioEngine;
  }

  function playMusicStep(engine) {
    var now = engine.context.currentTime;
    var step = engine.musicStep % upbeatLeadPattern.length;

    var lead = engine.context.createOscillator();
    var leadGain = engine.context.createGain();
    lead.type = step % 4 === 0 ? "square" : "triangle";
    lead.frequency.setValueAtTime(upbeatLeadPattern[step], now);
    leadGain.gain.setValueAtTime(0.0001, now);
    leadGain.gain.exponentialRampToValueAtTime(step % 4 === 0 ? 0.09 : 0.065, now + 0.008);
    leadGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.14);
    lead.connect(leadGain).connect(engine.music);
    lead.start(now);
    lead.stop(now + 0.15);

    if (step % 2 === 0) {
      var bass = engine.context.createOscillator();
      var bassGain = engine.context.createGain();
      bass.type = "sawtooth";
      bass.frequency.setValueAtTime(upbeatBassPattern[Math.floor(step / 4) % upbeatBassPattern.length], now);
      bassGain.gain.setValueAtTime(0.0001, now);
      bassGain.gain.exponentialRampToValueAtTime(0.045, now + 0.01);
      bassGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.25);
      bass.connect(bassGain).connect(engine.music);
      bass.start(now);
      bass.stop(now + 0.26);
    }

    var percussion = engine.context.createOscillator();
    var percussionGain = engine.context.createGain();
    var isDownbeat = step % 4 === 0;
    percussion.type = isDownbeat ? "sine" : "square";
    percussion.frequency.setValueAtTime(isDownbeat ? 145 : 3200, now);
    if (isDownbeat) percussion.frequency.exponentialRampToValueAtTime(48, now + 0.11);
    percussionGain.gain.setValueAtTime(isDownbeat ? 0.12 : 0.016, now);
    percussionGain.gain.exponentialRampToValueAtTime(0.0001, now + (isDownbeat ? 0.12 : 0.025));
    percussion.connect(percussionGain).connect(engine.music);
    percussion.start(now);
    percussion.stop(now + (isDownbeat ? 0.13 : 0.03));

    engine.musicStep += 1;
  }

  function syncAudio(enabled, volume, startMusic) {
    var engine = startMusic ? ensureAudioEngine() : audioEngine;
    if (!engine) return;
    var now = engine.context.currentTime;
    engine.master.gain.setTargetAtTime(enabled ? 1 : 0.0001, now, 0.025);
    engine.music.gain.setTargetAtTime(MUSIC_OUTPUT_GAIN * volume, now, 0.04);
    if (startMusic && engine.musicTimer === null) {
      playMusicStep(engine);
      engine.musicTimer = window.setInterval(function () { playMusicStep(engine); }, MUSIC_STEP_MS);
    }
  }

  function playClickTone() {
    var engine = ensureAudioEngine();
    if (!engine) return;
    var now = engine.context.currentTime;
    var oscillator = engine.context.createOscillator();
    var gain = engine.context.createGain();
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(520, now);
    oscillator.frequency.exponentialRampToValueAtTime(680, now + 0.045);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.08, now + 0.006);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.065);
    oscillator.connect(gain).connect(engine.effects);
    oscillator.start(now);
    oscillator.stop(now + 0.07);
  }

  function playAnswerTone(isCorrect) {
    var engine = ensureAudioEngine();
    if (!engine) return;
    var frequencies = isCorrect ? [620, 830] : [240, 170];
    var now = engine.context.currentTime;
    frequencies.forEach(function (frequency, index) {
      var oscillator = engine.context.createOscillator();
      var gain = engine.context.createGain();
      oscillator.type = isCorrect ? "sine" : "triangle";
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0.0001, now + index * 0.07);
      gain.gain.exponentialRampToValueAtTime(0.14, now + index * 0.07 + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + index * 0.07 + 0.16);
      oscillator.connect(gain).connect(engine.effects);
      oscillator.start(now + index * 0.07);
      oscillator.stop(now + index * 0.07 + 0.17);
    });
  }

  function playCountdownTone(value) {
    var engine = ensureAudioEngine();
    if (!engine) return;
    var now = engine.context.currentTime;
    var frequencies = value === 0 ? [659.25, 783.99, 1046.5] : [[587.33], [493.88], [392]][value - 1];
    frequencies.forEach(function (frequency, index) {
      var oscillator = engine.context.createOscillator();
      var gain = engine.context.createGain();
      var startsAt = now + index * 0.045;
      oscillator.type = value === 0 ? "square" : "sine";
      oscillator.frequency.setValueAtTime(frequency, startsAt);
      gain.gain.setValueAtTime(0.0001, startsAt);
      gain.gain.exponentialRampToValueAtTime(value === 0 ? 0.2 : 0.16, startsAt + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, startsAt + (value === 0 ? 0.32 : 0.22));
      oscillator.connect(gain).connect(engine.effects);
      oscillator.start(startsAt);
      oscillator.stop(startsAt + (value === 0 ? 0.34 : 0.24));
    });
  }

  function playUnlockTone() {
    var engine = ensureAudioEngine();
    if (!engine) return;
    var now = engine.context.currentTime;
    [523.25, 783.99].forEach(function (frequency, index) {
      var oscillator = engine.context.createOscillator();
      var gain = engine.context.createGain();
      var startsAt = now + index * 0.075;
      oscillator.type = "triangle";
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0.0001, startsAt);
      gain.gain.exponentialRampToValueAtTime(0.13, startsAt + 0.008);
      gain.gain.exponentialRampToValueAtTime(0.0001, startsAt + 0.16);
      oscillator.connect(gain).connect(engine.effects);
      oscillator.start(startsAt);
      oscillator.stop(startsAt + 0.17);
    });
  }

  function vibrate(pattern) {
    if (navigator.vibrate) navigator.vibrate(pattern);
  }

  function toggleSound() {
    state.soundEnabled = !state.soundEnabled;
    savePreferences();
    syncAudio(state.soundEnabled, state.musicVolume, state.soundEnabled);
    render();
  }

  function toggleBoothMode() {
    state.boothMode = !state.boothMode;
    document.body.classList.toggle("booth-mode", state.boothMode);
    var button = app.querySelector(".booth-toggle");
    if (button) {
      button.classList.toggle("booth-toggle--active", state.boothMode);
      button.setAttribute("aria-pressed", String(state.boothMode));
    }
    if (state.boothMode && !document.fullscreenElement && document.documentElement.requestFullscreen) {
      var fullscreenPromise = document.documentElement.requestFullscreen();
      if (fullscreenPromise && fullscreenPromise.catch) fullscreenPromise.catch(function () {});
    } else if (!state.boothMode && document.fullscreenElement && document.exitFullscreen) {
      var exitPromise = document.exitFullscreen();
      if (exitPromise && exitPromise.catch) exitPromise.catch(function () {});
    }
  }

  function startReadyCountdown() {
    stopCountdownTimer();
    state.screen = "countdown";
    state.countdownValue = 3;
    syncAudio(state.soundEnabled, state.musicVolume, true);
    render();
    if (state.soundEnabled) playCountdownTone(3);
    vibrate([18, 35, 18]);

    function advanceCountdown() {
      state.countdownValue -= 1;
      var number = app.querySelector(".countdown-number");
      if (number) {
        number.textContent = state.countdownValue === 0 ? t("go") : String(state.countdownValue);
        number.classList.toggle("countdown-number--go", state.countdownValue === 0);
        number.style.animation = "none";
        void number.offsetWidth;
        number.style.animation = "";
      }
      if (state.soundEnabled) playCountdownTone(state.countdownValue);

      if (state.countdownValue === 0) {
        state.countdownTimer = window.setTimeout(function () {
          state.countdownTimer = 0;
          state.roundPhase = "reading";
          state.timeLeft = READ_SECONDS;
          state.screen = "game";
          render();
        }, 650);
      } else {
        state.countdownTimer = window.setTimeout(advanceCountdown, 760);
      }
    }

    state.countdownTimer = window.setTimeout(advanceCountdown, 760);
  }

  function stopCountdownTimer() {
    if (state.countdownTimer) window.clearTimeout(state.countdownTimer);
    state.countdownTimer = 0;
  }

  function openSetup() {
    stopRoundTimer();
    stopFeedbackTimer();
    stopCountdownTimer();
    state.nickname = "";
    state.nicknameError = "";
    state.showClearLeaderboard = false;
    state.screen = "setup";
    state.outcome = null;
    state.selectedIndex = null;
    render();
    window.setTimeout(function () {
      var input = app.querySelector("#player-name");
      if (input) input.focus();
    }, 0);
  }

  function returnHome() {
    stopRoundTimer();
    stopFeedbackTimer();
    stopCountdownTimer();
    state.screen = "home";
    state.showHowTo = false;
    state.showClearLeaderboard = false;
    state.outcome = null;
    state.selectedIndex = null;
    render();
  }

  document.addEventListener("fullscreenchange", function () {
    if (!document.fullscreenElement && state.boothMode) {
      state.boothMode = false;
      document.body.classList.remove("booth-mode");
      var button = app.querySelector(".booth-toggle");
      if (button) {
        button.classList.remove("booth-toggle--active");
        button.setAttribute("aria-pressed", "false");
      }
    }
  });

  document.addEventListener("pointerdown", function (event) {
    if (!event.target || !event.target.closest) return;
    var interactive = event.target.closest("button, input[type='range']");
    if (!interactive) return;
    vibrate(7);
    syncAudio(state.soundEnabled, state.musicVolume, true);
    if (state.soundEnabled) playClickTone();
  });

  document.addEventListener("keydown", function (event) {
    if (state.showHowTo && event.key === "Escape") {
      event.preventDefault();
      state.showHowTo = false;
      render();
      return;
    }
    var question = currentQuestion();
    if (state.screen === "game" && question && !state.outcome && state.roundPhase === "answering" && /^[1-4]$/.test(event.key) && Number(event.key) <= question.items.length) {
      event.preventDefault();
      selectAnswer(Number(event.key) - 1);
    }
  });

  render();
})();
