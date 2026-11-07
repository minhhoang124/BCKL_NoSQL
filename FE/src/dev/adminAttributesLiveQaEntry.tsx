import { createRoot } from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import { AuthProvider } from '../contexts/AuthProvider';
import '../index.css';

const root = document.getElementById('root');
if (root) {
  const view = createRoot(root);
  if (import.meta.env.DEV) {
    void import('./AdminAttributesLiveQa').then(({ AdminAttributesLiveQa }) => {
      view.render(<HashRouter><AuthProvider><AdminAttributesLiveQa /></AuthProvider></HashRouter>);
    });
  } else view.render(<p>QA Attributes thật chỉ dùng trong môi trường phát triển.</p>);
}
