import { Link, NavLink, Route, Routes } from 'react-router-dom';
import Upload from './pages/Upload.jsx';
import DropCreated from './pages/DropCreated.jsx';
import Access from './pages/Access.jsx';
import Download from './pages/Download.jsx';

const navClass = ({ isActive }) =>
  `rounded-md px-3 py-2 text-sm font-medium transition-colors ${
    isActive ? 'bg-ink text-chalk' : 'text-slate hover:text-ink'
  }`;

function NotFound() {
  return (
    <div className="max-w-xl">
      <h1 className="text-4xl font-semibold tracking-tight">Nothing here</h1>
      <p className="mt-3 text-slate">That page does not exist, or the drop it belonged to is gone.</p>
      <Link to="/" className="mt-6 inline-block font-semibold text-signal underline underline-offset-4">
        Send a file
      </Link>
    </div>
  );
}

export default function App() {
  return (
    <div className="mx-auto flex min-h-screen w-full max-w-6xl flex-col px-5 sm:px-8">
      <header className="flex items-center justify-between py-6">
        <Link to="/" className="flex items-center gap-2.5 text-lg font-semibold tracking-tight">
          <span aria-hidden="true" className="grid size-7 place-items-center rounded-lg bg-signal">
            <span className="size-2.5 rounded-full bg-white" />
          </span>
          Zero Drop
        </Link>
        <nav aria-label="Main" className="flex gap-1">
          <NavLink to="/" end className={navClass}>
            Send
          </NavLink>
          <NavLink to="/access" className={navClass}>
            Receive
          </NavLink>
        </nav>
      </header>

      <main className="flex-1 pb-16 pt-4 sm:pt-10">
        <Routes>
          <Route path="/" element={<Upload />} />
          <Route path="/created/:id" element={<DropCreated />} />
          <Route path="/access" element={<Access />} />
          <Route path="/download/:id" element={<Download />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </main>

      <footer className="border-t border-line py-6 text-sm text-slate">
        Files are encrypted on the server and deleted when time runs out or the last download finishes.
      </footer>
    </div>
  );
}
