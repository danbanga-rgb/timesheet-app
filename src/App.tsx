import TimesheetSystem from './TimesheetSystem'
import ChatApp from './roles/Chat'

export default function App() {
  // /chat routes to the chat surface. Everything else = main TimesheetSystem.
  // Simple pathname check — no router library needed. Subdomain routing
  // (chat.mysynergie.net) lands in Slice 2b.
  if (window.location.pathname.startsWith('/chat')) {
    return <ChatApp />
  }
  return <TimesheetSystem />
}
