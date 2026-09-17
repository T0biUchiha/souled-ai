import { createBrowserRouter } from 'react-router-dom';
import { AppShell } from './shell';
import { HomePage, NotFoundPage } from '../features/home/pages';
import { NotesListPage } from '../features/notes-list/notes-list-page';

export const router = createBrowserRouter([
  {
    element: <AppShell />,
    children: [
      { index: true, element: <HomePage /> },
      { path: 'notes', element: <NotesListPage /> },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
]);
