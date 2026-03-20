(function loadShellPartials() {
  function loadPartial(url) {
    const xhr = new XMLHttpRequest();
    xhr.open("GET", url, false);
    try {
      xhr.send(null);
    } catch {
      return "";
    }
    return xhr.status >= 200 && xhr.status < 300 ? xhr.responseText : "";
  }

  const sidebarHost = document.getElementById("shellSidebar");
  const topNavHost = document.getElementById("shellTopNav");
  if (sidebarHost) {
    sidebarHost.innerHTML = loadPartial("/partials/sidebar.html");
  }
  if (topNavHost) {
    topNavHost.innerHTML = loadPartial("/partials/topnav.html");
  }
})();
