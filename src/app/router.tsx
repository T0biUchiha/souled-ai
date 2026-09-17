import { createBrowserRouter } from 'react-router-dom';
import { AppShell } from './shell';
import { HomePage, NotFoundPage } from '../features/home/pages';
import { NotesListPage } from '../features/notes-list/notes-list-page';
import { NoteDetailPage } from '../features/note-detail/note-detail-page';

export const router = createBrowserRouter([
  {
    element: <AppShell />,
    children: [
      { index: true, element: <HomePage /> },
      { path: 'notes', element: <NotesListPage /> },
      { path: 'notes/:noteId', element: <NoteDetailPage /> },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
]);
