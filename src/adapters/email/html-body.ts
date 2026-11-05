export type Signature = { content: Buffer; filename: string; alt: string };

export const SIGNATURE_CID = 'assinatura';

const escapeHtml = (text: string): string => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// The approved plain text stays the source of truth; the HTML only adds the signature image after it.
// `imageSrc` is `cid:` for a real e-mail and a data URI for the local preview.
export const htmlBody = (text: string, signature: Signature, imageSrc: string): string => {
  const paragraphs = text
    .split(/\n{2,}/)
    .map((paragraph) => `<p style="margin:0 0 1em">${escapeHtml(paragraph).replace(/\n/g, '<br>')}</p>`)
    .join('');
  return `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#222">${paragraphs}<img src="${imageSrc}" alt="${escapeHtml(signature.alt)}" width="560" style="display:block;max-width:100%;height:auto;border:0"></div>`;
};
