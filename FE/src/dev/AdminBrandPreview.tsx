import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { AdminBrandPreviewControls } from './AdminBrandPreviewControls';
import '../index.css';
const root = document.getElementById('root');
if (root) createRoot(root).render(import.meta.env.DEV ? <StrictMode><AdminBrandPreviewControls /></StrictMode> : <p>Chỉ dùng preview trong development.</p>);
