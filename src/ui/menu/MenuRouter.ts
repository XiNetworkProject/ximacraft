import { focusPrimary, MenuPage, MenuRoute } from "./MenuPage";
import { MenuTransitionSystem } from "./MenuTransitionSystem";

export class MenuRouter {
  private readonly pages = new Map<MenuRoute, MenuPage>();
  private readonly history: MenuRoute[] = [];
  private readonly transitions = new MenuTransitionSystem();
  private currentPage: MenuPage | null = null;

  register(page: MenuPage): void {
    this.pages.set(page.route, page);
    page.element.classList.add("menu-page");
    page.element.setAttribute("aria-hidden", "true");
  }

  get current(): MenuRoute | null {
    return this.currentPage?.route ?? null;
  }

  navigate(route: MenuRoute, replace = false): void {
    const page = this.pages.get(route);
    if (!page) throw new Error(`Missing menu route ${route}`);
    if (this.currentPage?.route === route) {
      this.hideAllExcept(page);
      page.focusPrimary();
      return;
    }
    if (this.currentPage && !replace) this.history.push(this.currentPage.route);
    const previous = this.currentPage?.element ?? null;
    this.currentPage = page;
    this.hideAllExcept(page);
    this.transitions.show(previous, page.element, route);
    window.setTimeout(() => page.focusPrimary(), 40);
  }

  back(fallback: MenuRoute = "home"): MenuRoute {
    const previous = this.history.pop() ?? fallback;
    this.navigate(previous, true);
    return previous;
  }

  clearHistory(): void {
    this.history.length = 0;
  }

  focusPrimary(): void {
    if (this.currentPage) focusPrimary(this.currentPage.element);
  }

  private hideAllExcept(active: MenuPage): void {
    for (const page of this.pages.values()) {
      if (page === active) continue;
      page.element.classList.remove("active");
      page.element.setAttribute("aria-hidden", "true");
    }
  }
}
