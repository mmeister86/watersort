const app = document.querySelector<HTMLDivElement>('#app');

if (app === null) {
  throw new Error('#app element not found');
}

app.textContent = 'Water Sort';
