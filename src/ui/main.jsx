import React from 'react';
import { createRoot } from 'react-dom/client';
import { TooltipProvider } from './components/ui/tooltip';
import App from './App';
import './style.css';

if (window.tutorDesktop) document.documentElement.dataset.desktop = window.tutorDesktop.platform;

createRoot(document.getElementById('root')).render(
  <TooltipProvider>
    <App />
  </TooltipProvider>,
);
