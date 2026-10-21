// Command palette entries for the mail screens' forms and records.
import { useEffect } from 'preact/hooks';
import { registerPaletteItems } from '../palette';
import { setPicked } from './drafts';
import { mailTab, type MailTab } from './MailSettings';

export function useMailPalette(): void {
  useEffect(() => {
    const tab = (t: MailTab) => () => { mailTab.value = t; };
    return registerPaletteItems([
      { label: 'Mail configuration', route: 'mailsettings', action: tab('conf'), group: 'Mail', keywords: 'bbs call streams isp pop3 smtp filters reject hold' },
      { label: 'Welcome messages and prompts', route: 'mailsettings', action: tab('wel'), group: 'Mail', keywords: 'welcome prompt signoff bye' },
      { label: 'White pages', route: 'mailsettings', action: tab('wp'), group: 'Mail', keywords: 'wp qth zip home bbs' },
      { label: 'RMS forwarding', route: 'forwarding', action: () => setPicked('forwarding', 'RMS'), group: 'Mail', keywords: 'winlink cms interval connect script' },
      { label: 'Message lifetimes', route: 'housekeeping', group: 'Mail', keywords: 'housekeeping expire bid purge days' },
    ]);
  }, []);
}
