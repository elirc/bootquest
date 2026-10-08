import { render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { ApiProvider } from '../api/context';
import { createMockApi } from '../api/mock';
import type { BootQuestApi } from '../api/types';
import { App } from '../App';

let currentPath = '';
function LocationProbe() {
  currentPath = useLocation().pathname;
  return null;
}

/** Mounts the whole app at `path` with a fresh mock API (no shared state between tests). */
export function renderApp(path = '/', api: BootQuestApi = createMockApi()) {
  const user = userEvent.setup();
  const utils = render(
    <ApiProvider api={api}>
      <MemoryRouter initialEntries={[path]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <App />
        <LocationProbe />
      </MemoryRouter>
    </ApiProvider>,
  );
  return { ...utils, user, api, path: () => currentPath };
}
