import '@fontsource-variable/archivo/standard.css';
import '@fontsource-variable/martian-mono/standard.css';
import '@fontsource/pixelify-sans/600.css';
import { mount } from 'svelte';
import './app.css';
import App from './ui/App.svelte';

mount(App, { target: document.getElementById('app')! });
