import { MenuRoute } from "./MenuPage";

export class MenuTransitionSystem {
  show(previous: HTMLElement | null, next: HTMLElement, route: MenuRoute): void {
    if (previous && previous !== next) {
      previous.classList.remove("active");
      previous.setAttribute("aria-hidden", "true");
    }
    next.dataset.route = route;
    next.classList.add("active");
    next.setAttribute("aria-hidden", "false");
  }
}
