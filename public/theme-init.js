try {
  var pref = localStorage.getItem("devpanel-theme-preference");
  var lightThemes = { daylight: true, paper: true };
  var darkThemes = { midnight: true, obsidian: true, nord: true };
  var meta = document.querySelector('meta[name="color-scheme"]');
  if (lightThemes[pref]) {
    meta.content = "light";
    document.documentElement.dataset.theme = pref;
  } else if (darkThemes[pref]) {
    meta.content = "dark";
    document.documentElement.dataset.theme = pref;
    document.documentElement.classList.add("dark");
  } else {
    meta.content = "light dark";
    var isDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
    document.documentElement.dataset.theme = isDark ? "midnight" : "daylight";
    if (isDark) document.documentElement.classList.add("dark");
  }

  var rawSettings = localStorage.getItem("devpanel-settings-v1");
  var langPref = rawSettings ? JSON.parse(rawSettings).language : "system";
  if (langPref === "en" || langPref === "zh-CN") {
    document.documentElement.lang = langPref;
  } else {
    var navLang = (navigator.language || "zh-CN").toLowerCase();
    document.documentElement.lang = navLang.indexOf("zh") === 0 ? "zh-CN" : "en";
  }
} catch (e) {}
