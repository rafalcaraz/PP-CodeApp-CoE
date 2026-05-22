// Only export the Launcher from the barrel. The Panel is dynamically
// imported from inside the Launcher to keep it in its own lazy chunk; if we
// re-exported it here, Vite would fold it back into the parent bundle and
// negate the code-split.
export { CopilotChatLauncher } from "./CopilotChatLauncher";
