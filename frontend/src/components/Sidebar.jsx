import { NavLink } from 'react-router-dom';

export default function Sidebar({
  conversations,
  currentConversationId,
  onSelectConversation,
  onNewConversation,
}) {
  return (
    <aside className="flex w-72 shrink-0 flex-col border-r border-gray-800 bg-[#12141c]">
      <div className="border-b border-gray-800 p-4">
        <h1 className="text-lg font-semibold text-white">TinyLM Council</h1>
        <p className="mt-1 text-xs text-gray-400">Small-model LLM deliberation</p>
      </div>

      <div className="flex gap-2 border-b border-gray-800 p-3">
        <NavLink
          to="/"
          className={({ isActive }) =>
            `rounded-md px-3 py-1.5 text-sm ${isActive ? 'bg-indigo-600 text-white' : 'text-gray-300 hover:bg-gray-800'}`
          }
        >
          Chat
        </NavLink>
        <NavLink
          to="/models"
          className={({ isActive }) =>
            `rounded-md px-3 py-1.5 text-sm ${isActive ? 'bg-indigo-600 text-white' : 'text-gray-300 hover:bg-gray-800'}`
          }
        >
          Models
        </NavLink>
        <NavLink
          to="/settings"
          className={({ isActive }) =>
            `rounded-md px-3 py-1.5 text-sm ${isActive ? 'bg-indigo-600 text-white' : 'text-gray-300 hover:bg-gray-800'}`
          }
        >
          Settings
        </NavLink>
      </div>

      <div className="p-3">
        <button
          onClick={onNewConversation}
          className="w-full rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500"
        >
          + New conversation
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-2 pb-4">
        {conversations.length === 0 ? (
          <p className="px-2 text-sm text-gray-500">No conversations yet</p>
        ) : (
          conversations.map((conv) => (
            <button
              key={conv.id}
              onClick={() => onSelectConversation(conv.id)}
              className={`mb-1 w-full rounded-lg px-3 py-2 text-left text-sm transition ${
                currentConversationId === conv.id
                  ? 'bg-gray-800 text-white'
                  : 'text-gray-300 hover:bg-gray-800/60'
              }`}
            >
              <div className="truncate font-medium">{conv.title}</div>
              <div className="text-xs text-gray-500">{conv.message_count} messages</div>
            </button>
          ))
        )}
      </div>
    </aside>
  );
}
