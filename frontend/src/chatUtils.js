export const createChatSubmitHandler = ({
  request,
  FormDataConstructor = FormData,
}) => async (event) => {
  event.preventDefault();
  const formElement = event.currentTarget;
  const form = new FormDataConstructor(formElement);
  const message = formElement.querySelector("#chat-message");
  try {
    const result = await request("/api/chat", {
      method: "POST",
      body: JSON.stringify({ message: form.get("message") }),
    });
    message.textContent = result.answer;
    message.className = "message success";
    formElement.reset();
  } catch (error) {
    message.textContent = error.message;
  }
};
