"use client";

import { useEffect } from 'react';

function lensName(label: string, index: number) {
  const normalized = label.replace(/câmera|camera/gi, '').replace(/\s+/g, ' ').trim();
  const lower = normalized.toLocaleLowerCase('pt-BR');

  if (lower.includes('ultra')) return 'Ultra-angular';
  if (lower.includes('tele')) return 'Teleobjetiva';
  if (lower.includes('front') || lower.includes('frontal')) return 'Frontal';
  if (lower.includes('triple')) return 'Traseira tripla';
  if (lower.includes('dual wide')) return 'Traseira dupla';
  if (lower.includes('back') || lower.includes('rear') || lower.includes('trase')) return 'Traseira';
  if (lower.includes('wide')) return 'Grande-angular';
  return normalized || `Lente ${index + 1}`;
}

export default function CameraUiEnhancements() {
  useEffect(() => {
    const enhanceDeviceName = () => {
      document.querySelectorAll<HTMLElement>('.camera-title-pill').forEach((pill) => {
        if (pill.dataset.deviceRename === 'ready') return;
        pill.dataset.deviceRename = 'ready';
        pill.setAttribute('role', 'button');
        pill.setAttribute('tabindex', '0');
        pill.setAttribute('aria-label', 'Renomear este aparelho');
        pill.setAttribute('title', 'Renomear este aparelho');

        const rename = () => document.querySelector<HTMLButtonElement>('.device-pill')?.click();
        pill.addEventListener('click', rename);
        pill.addEventListener('keydown', (event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            rename();
          }
        });
      });
    };

    const enhanceLensRail = () => {
      document.querySelectorAll<HTMLElement>('.lens-rail').forEach((rail) => {
        const buttons = Array.from(rail.children).filter((child): child is HTMLButtonElement => child instanceof HTMLButtonElement);
        if (buttons.length < 2) return;

        rail.classList.add('liquid-lens-picker');
        const signature = buttons.map((button) => button.title).join('|');
        let select = rail.querySelector<HTMLSelectElement>('select[data-anyphoto-lens-picker]');

        if (!select) {
          select = document.createElement('select');
          select.dataset.anyphotoLensPicker = 'true';
          select.setAttribute('aria-label', 'Selecionar lente da câmera');
          rail.appendChild(select);
          select.addEventListener('change', () => {
            const index = Number(select?.value ?? -1);
            buttons[index]?.click();
          });
        }

        if (rail.dataset.lensSignature !== signature) {
          const baseLabels = buttons.map((button, index) => lensName(button.title, index));
          const labels = baseLabels.map((label, index) => {
            const duplicate = baseLabels.indexOf(label) !== baseLabels.lastIndexOf(label);
            return duplicate ? `${label} ${index + 1}` : label;
          });
          select.replaceChildren(...labels.map((label, index) => {
            const option = document.createElement('option');
            option.value = String(index);
            option.textContent = label;
            return option;
          }));
          rail.dataset.lensSignature = signature;
        }

        const activeIndex = Math.max(0, buttons.findIndex((button) => button.classList.contains('active')));
        select.value = String(activeIndex);
      });
    };

    const enhance = () => {
      enhanceDeviceName();
      enhanceLensRail();
    };

    enhance();
    const observer = new MutationObserver(enhance);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'title'] });
    return () => observer.disconnect();
  }, []);

  return <style>{`
    .camera-title-pill[data-device-rename="ready"] {
      position: relative;
      padding-right: 32px;
      cursor: pointer;
      user-select: none;
      transition: border-color .18s ease, background .18s ease, transform .18s ease;
    }
    .camera-title-pill[data-device-rename="ready"]::after {
      content: '✎';
      position: absolute;
      right: 11px;
      top: 50%;
      transform: translateY(-50%);
      color: rgba(225,235,249,.55);
      font-size: .72rem;
      font-weight: 700;
    }
    .camera-title-pill[data-device-rename="ready"]:hover,
    .camera-title-pill[data-device-rename="ready"]:focus-visible {
      border-color: rgba(125,170,255,.34);
      background: rgba(9,15,23,.76);
      outline: none;
    }
    .camera-title-pill[data-device-rename="ready"]:active { transform: scale(.985); }

    .lens-rail.liquid-lens-picker {
      position: absolute !important;
      z-index: 6 !important;
      top: auto !important;
      right: 16px !important;
      bottom: 52px !important;
      transform: none !important;
      display: block !important;
      width: auto !important;
      min-width: 156px;
      max-width: min(220px, calc(100% - 32px));
      padding: 0 !important;
      border: 0 !important;
      border-radius: 18px !important;
      background: transparent !important;
      box-shadow: none !important;
      backdrop-filter: none !important;
      -webkit-backdrop-filter: none !important;
    }
    .lens-rail.liquid-lens-picker > button { display: none !important; }
    .lens-rail.liquid-lens-picker::after {
      content: '';
      position: absolute;
      pointer-events: none;
      right: 15px;
      top: 50%;
      width: 7px;
      height: 7px;
      border-right: 1.5px solid rgba(238,244,255,.78);
      border-bottom: 1.5px solid rgba(238,244,255,.78);
      transform: translateY(-68%) rotate(45deg);
    }
    .lens-rail.liquid-lens-picker select {
      appearance: none;
      -webkit-appearance: none;
      width: 100%;
      min-height: 46px;
      padding: 0 40px 0 16px;
      border-radius: 18px;
      border: 1px solid rgba(255,255,255,.18);
      color: #f5f7fb;
      background:
        linear-gradient(180deg, rgba(42,46,53,.54), rgba(16,18,23,.48)),
        rgba(16,18,23,.42);
      box-shadow:
        inset 0 1px 0 rgba(255,255,255,.16),
        inset 0 -1px 0 rgba(255,255,255,.035),
        0 14px 38px rgba(0,0,0,.26);
      backdrop-filter: blur(24px) saturate(145%);
      -webkit-backdrop-filter: blur(24px) saturate(145%);
      font-size: .72rem;
      font-weight: 760;
      letter-spacing: -.01em;
      outline: none;
      cursor: pointer;
    }
    .lens-rail.liquid-lens-picker select:focus {
      border-color: rgba(119,165,255,.52);
      box-shadow:
        inset 0 1px 0 rgba(255,255,255,.18),
        0 0 0 3px rgba(52,120,246,.12),
        0 14px 38px rgba(0,0,0,.28);
    }
    .lens-rail.liquid-lens-picker select option { color: #111318; background: #f3f5f8; }

    @media (max-width: 620px) {
      .lens-rail.liquid-lens-picker {
        right: 12px !important;
        bottom: 50px !important;
        min-width: 144px;
        max-width: 52vw;
      }
      .lens-rail.liquid-lens-picker select {
        min-height: 44px;
        padding-left: 14px;
        font-size: .69rem;
        border-radius: 17px;
      }
      .camera-title-pill[data-device-rename="ready"] { padding-right: 30px; }
    }
  `}</style>;
}
