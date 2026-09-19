export const createChatSubmitHandler = ({
  request,
  FormDataConstructor = FormData,
}) => async (event) => {
  event.preventDefault();
  const formElement = event.currentTarget;
  const form = new FormDataConstructor(formElement);
  const message = formElement.querySelector("#chat-message");
  const languageControl = formElement.querySelector("#chat-language");
  const simplifyControl = formElement.querySelector("#chat-simplify");
  const submit = formElement.querySelector("button[type=submit]");
  const language = languageControl?.value || "en";
  const simplify = language === "en-simple" || Boolean(simplifyControl?.checked);
  try {
    if (submit) submit.disabled = true;
    message.textContent = "Preparing your verified response…";
    const result = await request("/api/chat", {
      method: "POST",
      body: JSON.stringify({ message: form.get("message"), language, simplify }),
    });
    message.textContent = result.answer;
    const emergencySeverity = result.emergency?.severity;
    const isEmergency = emergencySeverity === "EMERGENCY" || emergencySeverity === "URGENT";
    message.className = isEmergency
      ? `message emergency-alert emergency-${emergencySeverity.toLowerCase()}`
      : "message success";
    if (typeof message.setAttribute === "function") {
      message.setAttribute("role", isEmergency ? "alert" : "status");
      message.setAttribute("aria-live", isEmergency ? "assertive" : "polite");
    }
    formElement.reset();
    if (languageControl) languageControl.value = language;
    if (simplifyControl) simplifyControl.checked = simplify && language !== "en-simple";
  } catch (error) {
    message.textContent = error.message;
  } finally {
    if (submit) submit.disabled = false;
  }
};
