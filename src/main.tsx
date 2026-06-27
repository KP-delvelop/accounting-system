import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import { HostedAuthProvider } from './hostedAuth';
import './styles.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <HostedAuthProvider>
      <App />
    </HostedAuthProvider>
  </React.StrictMode>,
);
