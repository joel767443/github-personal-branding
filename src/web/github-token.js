async function getJson(url, opts) {
  const resp = await fetch(url, {
    credentials: "include",
    ...(opts ?? {}),
  });
  const json = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(json?.error || json?.details || `Request failed (${resp.status})`);
  return json;
}

const githubPatInput = document.getElementById("githubPatInput");
const deployRepoUrlInput = document.getElementById("deployRepoUrlInput");
const btnSaveGithubPat = document.getElementById("btnSaveGithubPat");
const githubPatMsg = document.getElementById("githubPatMsg");

async function loadTokenForm() {
  try {
    const data = await getJson("/api/settings/developer");
    const d = data?.developer;
    if (!d) return;
    if (deployRepoUrlInput) deployRepoUrlInput.value = d.deployRepoUrl ?? "";
    if (githubPatInput) githubPatInput.value = "";
  } catch (err) {
    if (githubPatMsg) githubPatMsg.textContent = err?.message || String(err);
  }
}

async function submitGithubTokenSettings() {
  const token = githubPatInput?.value?.trim() ?? "";
  const deployRepoUrl = deployRepoUrlInput?.value?.trim() ?? "";

  if (!token) {
    if (githubPatMsg) githubPatMsg.textContent = "Enter a GitHub personal access token.";
    return;
  }

  if (githubPatMsg) githubPatMsg.textContent = "Saving...";
  if (btnSaveGithubPat) btnSaveGithubPat.disabled = true;

  try {
    await getJson("/api/settings/developer", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ githubPat: token, deployRepoUrl }),
    });
    if (githubPatMsg) githubPatMsg.textContent = "Saved.";
    if (githubPatInput) githubPatInput.value = "";
    await loadTokenForm();
  } catch (err) {
    if (githubPatMsg) githubPatMsg.textContent = err?.message || String(err);
  } finally {
    if (btnSaveGithubPat) btnSaveGithubPat.disabled = false;
  }
}

btnSaveGithubPat?.addEventListener("click", submitGithubTokenSettings);
loadTokenForm();
