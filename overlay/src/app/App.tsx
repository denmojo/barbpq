import { route } from './router';
import { effectiveTheme, toggleTheme } from '../ui/theme';

export function App() {
  return (
    <main class="shell">
      <h1>BarBPQ - LinBPQ Web UI</h1>
      <p class="muted">Route: <span data-testid="route">{route.value}</span></p>
      <button type="button" onClick={toggleTheme}>Theme: {effectiveTheme()}</button>
    </main>
  );
}
