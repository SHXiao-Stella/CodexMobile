import { Composer } from '../composer/Composer.jsx';
import { ChatPane } from '../chat/ChatPane.jsx';
import { DesktopApprovalBanner } from '../chat/DesktopApprovalBanner.jsx';
import { ImagePreviewModal } from '../chat/ImagePreview.jsx';
import { ConnectionRecoveryCard, DocsPanel, Drawer, GitPanel, ToastStack, TopBar } from '../panels/index.js';

export function AppShell({ shellClass, panelProps, drawerProps, chatProps, composerProps }) {
  const {
    topBarProps,
    docsPanelProps,
    gitPanelProps,
    recoveryCardProps,
    toastStackProps,
    imagePreviewProps,
    desktopApprovalProps
  } = panelProps;

  return (
    <div className={shellClass}>
      <TopBar {...topBarProps} />
      <Drawer {...drawerProps} />
      <DocsPanel {...docsPanelProps} />
      <GitPanel {...gitPanelProps} />
      <ConnectionRecoveryCard {...recoveryCardProps} />
      <ToastStack {...toastStackProps} />
      <DesktopApprovalBanner {...desktopApprovalProps} />
      <ChatPane {...chatProps} />
      <Composer {...composerProps} />
      <ImagePreviewModal {...imagePreviewProps} />
    </div>
  );
}
