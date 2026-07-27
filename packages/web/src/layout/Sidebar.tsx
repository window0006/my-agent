import { Drawer } from 'antd';
import { useChatStore } from '../store/chat';
import { SessionList } from '../components/chat/SessionList';

export function Sidebar() {
  const { mobileSidebarOpen, setMobileSidebarOpen } = useChatStore();
  return (
    <>
      {/* Desktop persistent sidebar */}
      <aside className="desktop-only sidebar-pane">
        <SessionList />
      </aside>

      {/* Mobile drawer */}
      <Drawer
        title="会话"
        placement="left"
        open={mobileSidebarOpen}
        onClose={() => setMobileSidebarOpen(false)}
        width={300}
        styles={{ body: { padding: 0 } }}
      >
        <SessionList />
      </Drawer>
    </>
  );
}