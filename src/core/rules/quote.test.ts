import assert from 'node:assert/strict';
import test from 'node:test';
import { mentionsWord, quoteAppearsIn, readsAsSentence } from './quote.js';

const page = 'We build custom software\nfor clients across the UK.  Our team ships React and Node.js projects.';

test('aceita citação que existe na página, ignorando caixa e espaços', () => {
  assert.ok(quoteAppearsIn('we build custom software for clients', page));
});

test('rejeita citação inventada ou curta demais', () => {
  assert.ok(!quoteAppearsIn('we build rockets for NASA clients', page));
  assert.ok(!quoteAppearsIn('React', page));
});

test('tecnologia só conta como palavra inteira', () => {
  assert.ok(mentionsWord('React', page));
  assert.ok(mentionsWord('Node.js', page));
  assert.ok(!mentionsWord('Java', 'We use JavaScript daily'));
});

test('menu, título e lista de palavras não contam como frase', () => {
  for (const quote of [
    'Website Hosting & Support',
    'Experience AgriTech EdTech FinTech HRTech iGaming PropTech TravelTech',
    'Laravel Web Development Symfony Web Development CodeIgniter Web Development',
    'Ecommerce Websites Ecommerce Web Design WooCommerce Web Design',
  ])
    assert.ok(!readsAsSentence(quote), quote);
});

test('frase de verdade conta', () => {
  for (const quote of [
    'We partner with you to bring your software project to life, building a secure and scalable solution.',
    'Ongoing maintenance and evolution is available via PDaaS — the same AI-powered team, on demand.',
    'Taking on and turning around problematic software projects from other less experienced developers.',
  ])
    assert.ok(readsAsSentence(quote), quote);
});
