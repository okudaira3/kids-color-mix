import React from 'react';
import ReactDOM from 'react-dom/client';
import PaintPlayApp from '../PaintPlay.jsx';

document.body.style.margin = '0';
document.body.style.width = '100%';
document.body.style.minHeight = '100vh';

const rootElement = document.getElementById('root');
rootElement.style.width = '100%';
rootElement.style.minHeight = '100vh';

ReactDOM.createRoot(rootElement).render(<PaintPlayApp />);
