import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Clapperboard } from 'lucide-react';
import { api } from './workbench';
import FeatureGuide from './FeatureGuide';
import { GUIDE_VERSION } from '../guide-content.mjs';

const GuideContext = createContext(null);
export const useGuide = () => useContext(GuideContext);

export default function GuideProvider({ children }) {
  const [loaded, setLoaded] = useState(false);
  const [ready, setReady] = useState(false);
  const [open, setOpen] = useState(false);
  const [initialFeature, setInitialFeature] = useState(null);
  const [intent, setIntent] = useState(null);
  const seen = useRef(false);
  const intentId = useRef(0);
  useEffect(() => {
    let alive = true;
    api('/api/guide')
      .then((state) => {
        if (!alive) return;
        seen.current = state.seen === true && state.version === GUIDE_VERSION;
        setReady(seen.current);
        setOpen(!seen.current);
        setLoaded(true);
      })
      .catch(() => {
        if (alive) {
          setLoaded(true);
          setOpen(true);
        }
      });
    return () => {
      alive = false;
    };
  }, []);
  const openGuide = useCallback((feature = null) => {
    setInitialFeature(feature);
    setOpen(true);
  }, []);
  const closeGuide = useCallback((feature, message) => {
    if (feature) setIntent({ feature, message, id: ++intentId.current });
    setOpen(false);
    setReady(true);
    if (!seen.current) {
      seen.current = true;
      api('/api/guide', { version: GUIDE_VERSION }).catch(() => {
        seen.current = false;
      });
    }
  }, []);
  const consumeIntent = useCallback(() => setIntent(null), []);
  useEffect(() => {
    const shortcut = (event) => {
      if (event.key !== 'F1') return;
      event.preventDefault();
      openGuide();
    };
    window.addEventListener('keydown', shortcut);
    return () => window.removeEventListener('keydown', shortcut);
  }, [openGuide]);
  return (
    <GuideContext.Provider value={{ openGuide, intent, consumeIntent }}>
      {ready && children}
      {!loaded && (
        <div className="guide-loading">
          <Clapperboard size={30} />
          <span>正在准备 Tutor…</span>
        </div>
      )}
      <FeatureGuide
        open={open}
        firstRun={!ready}
        initialFeature={initialFeature}
        onClose={closeGuide}
      />
    </GuideContext.Provider>
  );
}
