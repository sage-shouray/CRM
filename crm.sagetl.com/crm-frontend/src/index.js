import React from 'react';
import ReactDOM from 'react-dom/client';
import './setupAxios'; // Global axios auth interceptor — must load before any API call
import './index.css';
import App from './App';
import reportWebVitals from './reportWebVitals';
import {BrowserRouter} from 'react-router-dom';
import 'react-toastify/ReactToastify.css';
import '@fortawesome/fontawesome-svg-core/styles.css';
import { config } from '@fortawesome/fontawesome-svg-core';

// Prevent Font Awesome from injecting its CSS at runtime; we import it above.
// Without this base CSS, icons render at full intrinsic size and overlap labels.
config.autoAddCss = false;

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>
);

// If you want to start measuring performance in your app, pass a function
// to log results (for example: reportWebVitals(console.log))
// or send to an analytics endpoint. Learn more: https://bit.ly/CRA-vitals
reportWebVitals();
