function byId(id) { return document.getElementById(id); }

const params = new URLSearchParams(location.search);
const isNewUser =
  sessionStorage.getItem("pt_is_new_user") === "1" ||
  params.get("new") === "1";

sessionStorage.removeItem("pt_is_new_user");

const title = byId("welcome-title");
const sub = byId("welcome-sub");
const dashBtn = byId("btn-dashboard");

if (isNewUser) {
  if (title) title.textContent = "Welcome to ParkTag!";
  if (sub) sub.textContent = "Get started by activating your first tag.";
} else {
  if (title) title.textContent = "Welcome back!";
  if (sub) sub.textContent = "What would you like to do?";
  if (dashBtn) dashBtn.style.display = "";
}
