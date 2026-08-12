function createConfetti() {
  for (let i = 0; i < 30; i++) {
    const confetti = document.createElement('div');
    confetti.className = 'confetti';
    confetti.style.left = Math.random() * 100 + '%';
    confetti.style.animationDelay = Math.random() * 4 + 's';
    confetti.style.animationDuration = (Math.random() * 2 + 3) + 's';
    document.body.appendChild(confetti);
  }
}

function createSparkle(x, y) {
  const sparkle = document.createElement('div');
  sparkle.className = 'sparkle';
  sparkle.innerHTML = '✨';
  sparkle.style.left = x + 'px';
  sparkle.style.top = y + 'px';
  document.body.appendChild(sparkle);

  setTimeout(() => {
    sparkle.remove();
  }, 1500);
}

function createFirework() {
  const colors = ['#eecf6d', '#d5ac4e', '#8b6220', '#720e07', '#45050c'];

  for (let i = 0; i < 12; i++) {
    const firework = document.createElement('div');
    firework.className = 'firework';
    firework.style.background = colors[Math.floor(Math.random() * colors.length)];
    firework.style.left = Math.random() * window.innerWidth + 'px';
    firework.style.top = Math.random() * window.innerHeight + 'px';
    firework.style.animationDelay = Math.random() * 1 + 's';
    document.body.appendChild(firework);

    setTimeout(() => {
      firework.remove();
    }, 3000);
  }
}

function explodeCake() {
  const cake = document.querySelector('.cake');
  cake.style.animation = 'none';
  cake.style.transform = 'scale(0)';

  for (let i = 0; i < 30; i++) {
    const piece = document.createElement('div');
    piece.innerHTML = ['🍰', '🧁', '🍪', '🍩', '🍭'][Math.floor(Math.random() * 5)];
    piece.style.position = 'absolute';
    piece.style.fontSize = '2rem';
    piece.style.left = '50%';
    piece.style.top = '50%';
    piece.style.transform = 'translate(-50%, -50%)';
    piece.style.animation = `explode 2s ease-out forwards`;
    piece.style.animationDelay = Math.random() * 0.5 + 's';

    const angle = (Math.PI * 2 * i) / 30;
    const distance = 200 + Math.random() * 200;
    piece.style.setProperty('--end-x', Math.cos(angle) * distance + 'px');
    piece.style.setProperty('--end-y', Math.sin(angle) * distance + 'px');

    document.body.appendChild(piece);

    setTimeout(() => {
      piece.remove();
    }, 2000);
  }

  setTimeout(() => {
    cake.style.transform = 'scale(1)';
    cake.style.animation = 'rotate 4s linear infinite';
  }, 2000);
}

function partyMode() {
  for (let i = 0; i < 4; i++) {
    setTimeout(() => {
      createFirework();
    }, i * 600);
  }

  for (let i = 0; i < 60; i++) {
    setTimeout(() => {
      const confetti = document.createElement('div');
      confetti.className = 'confetti';
      confetti.style.left = Math.random() * 100 + '%';
      confetti.style.animationDelay = '0s';
      confetti.style.animationDuration = (Math.random() * 2 + 2) + 's';
      document.body.appendChild(confetti);

      setTimeout(() => {
        confetti.remove();
      }, 6000);
    }, i * 80);
  }

  const celebrationEmojis = ['🎉', '🎊', '🎈', '🎂', '🎁', '✨', '🌟', '💫'];
  for (let i = 0; i < 15; i++) {
    setTimeout(() => {
      const emoji = document.createElement('div');
      emoji.innerHTML = celebrationEmojis[Math.floor(Math.random() * celebrationEmojis.length)];
      emoji.style.position = 'absolute';
      emoji.style.fontSize = 'clamp(1.5rem, 3vw, 2.5rem)';
      emoji.style.left = Math.random() * 100 + '%';
      emoji.style.top = '100%';
      emoji.style.color = '#d5ac4e';
      emoji.style.animation = 'gentleFall 5s linear forwards';
      emoji.style.pointerEvents = 'none';
      document.body.appendChild(emoji);

      setTimeout(() => {
        emoji.remove();
      }, 5000);
    }, i * 300);
  }

  const button = document.querySelector('.party-button');
  const originalText = button.innerHTML;
  button.innerHTML = '🎉 Celebrating! 🎉';

  setTimeout(() => {
    button.innerHTML = originalText;
  }, 8000);
}

document.addEventListener('mousemove', (e) => {
  if (Math.random() > 0.8) {
    createSparkle(e.clientX, e.clientY);
  }
});

createConfetti();

setInterval(() => {
  if (Math.random() > 0.5) {
    createFirework();
  }
}, 10000);

setTimeout(() => {
  partyMode();
}, 2000);
