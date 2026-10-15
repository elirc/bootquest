import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { ApiProvider } from './api/context';
import { App } from './App';
import './styles/tokens.css';
import './styles/app.css';
import './styles/skilltree.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ApiProvider>
      <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <App />
      </BrowserRouter>
    </ApiProvider>
  </StrictMode>,
);
