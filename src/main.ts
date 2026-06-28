import "./styles.css";
import { Game } from "./game/Game";

const container = document.querySelector<HTMLDivElement>("#app");

if (!container) {
  throw new Error("Missing #app container.");
}

const game = new Game(container);
void game.initialize();
