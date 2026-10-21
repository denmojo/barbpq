import { render } from 'preact';
import { effect } from '@preact/signals';
import { App } from './app/App';
import { syncRoute } from './app/router';
import { applyTheme, loadThemeMode, watchSystemTheme } from './ui/theme';
import './ui/base.css';

loadThemeMode();
watchSystemTheme();
effect(applyTheme);
syncRoute();
render(<App />, document.getElementById('app')!);
