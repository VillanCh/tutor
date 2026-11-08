import React from 'react';
import { createRoot } from 'react-dom/client';
import { TooltipProvider } from './components/ui/tooltip';
import App from './App';
import YakcoolBoundary from './YakcoolAccount';
import GuideProvider from './GuideProvider';
import './style.css';
import './guide.css';

if (window.tutorDesktop) document.documentElement.dataset.desktop = window.tutorDesktop.platform;

createRoot(document.getElementById('root')).render(
  <TooltipProvider>
    <GuideProvider>
      <YakcoolBoundary>{(accountProps) => <App {...accountProps} />}</YakcoolBoundary>
    </GuideProvider>
  </TooltipProvider>,
);
