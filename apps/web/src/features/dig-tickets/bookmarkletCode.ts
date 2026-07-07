// Generates the Bookmarklet script as a minified string.
// We replace the API URL dynamically so it works on both localhost (development) and vercel (production).
export function getBookmarkletCode(origin: string): string {
  const code = `(async function() {
    const hash = window.location.hash || '';
    let ticketId = hash.match(/nscTicketId=([^&]+)/)?.[1];
    if (ticketId) {
      sessionStorage.setItem('nscTicketId', ticketId);
    } else {
      ticketId = sessionStorage.getItem('nscTicketId');
    }
    
    if (!ticketId) {
      alert('NSC Copilot: No active ticket ID found. Make sure the URL hash contains #nscTicketId=...');
      return;
    }
    
    let banner = document.getElementById('nsc-banner');
    if (!banner) {
      banner = document.createElement('div');
      banner.id = 'nsc-banner';
      banner.style.cssText = 'position:fixed;top:0;left:0;width:100%;background:#1d4ed8;color:white;padding:12px;z-index:999999;font-family:sans-serif;font-weight:bold;text-align:center;box-shadow:0 2px 10px rgba(0,0,0,0.3);font-size:14px;';
      document.body.appendChild(banner);
    }
    
    const updateBanner = (msg, success, error) => {
      banner.innerText = 'NSC Copilot: ' + msg;
      banner.style.background = error ? '#dc2626' : (success ? '#16a34a' : '#1d4ed8');
    };

    updateBanner('Fetching ticket specs...', false, false);
    
    try {
      const res = await fetch('${origin}/api/dig-tickets/' + ticketId);
      if (!res.ok) throw new Error('API fetch failed');
      const { ticket } = await res.json();
      const url = window.location.href;
      
      // 1. Dashboard
      if (url.includes('/excavatorTickets') || document.querySelector("select option[value*='business days']")) {
        const select = Array.from(document.querySelectorAll('select')).find(s => 
          Array.from(s.options).some(o => o.text.includes('2 full business days'))
        );
        if (select) {
          select.value = Array.from(select.options).find(o => o.text.includes('2 full business days')).value;
          select.dispatchEvent(new Event('change', { bubbles: true }));
          const btn = Array.from(document.querySelectorAll('button')).find(b => 
            b.textContent.includes('Create') || b.textContent.includes('Go')
          );
          if (btn) {
            updateBanner('Creating ticket...', true, false);
            setTimeout(() => btn.click(), 500);
          }
        }
        return;
      }
      
      // 2. Step 1 (Address)
      if (url.includes('Step1') || document.querySelector('input[placeholder="Search place or address"]')) {
        const addressInput = document.querySelector('input[placeholder="Search place or address"]');
        if (addressInput) {
          updateBanner('Searching address...', false, false);
          addressInput.focus();
          addressInput.value = ticket.address || '';
          addressInput.dispatchEvent(new Event('input', { bubbles: true }));
          setTimeout(() => {
            const down = new KeyboardEvent('keydown', { keyCode: 40, bubbles: true });
            const enter = new KeyboardEvent('keydown', { keyCode: 13, bubbles: true });
            addressInput.dispatchEvent(down);
            setTimeout(() => {
              addressInput.dispatchEvent(enter);
              updateBanner('Address centered! Draw locates on map, then click Next.', true, false);
            }, 500);
          }, 1500);
        }
        return;
      }
      
      // 3. Step 2 (Form)
      if (url.includes('Step2') || document.querySelector('textarea#location')) {
        updateBanner('Autofilling details...', false, false);
        
        const setVal = (sel, val, type='input') => {
          const el = document.querySelector(sel);
          if (el) {
            el.value = val;
            el.dispatchEvent(new Event(type, { bubbles: true }));
          }
        };
        
        setVal('textarea#location', ticket.markingInstructions);
        setVal('textarea#remarks1', ticket.markingInstructions);
        setVal('input#type_of_work', ticket.specs.workType);
        setVal('select#boring', ticket.specs.directionalBoring ? 'Yes' : 'No', 'change');
        setVal('select#area_marked', ticket.specs.whiteLined ? 'Yes' : 'No', 'change');
        setVal('input#work_done_for', 'LUMEN');
        
        // jQuery components injection
        const eqMap = {
          auger: 'Auger', backhoe: 'Backhoe/Trackhoe', trackhoe: 'Backhoe/Trackhoe', excavator: 'Backhoe/Trackhoe',
          boring: 'Directional Drilling', 'directional boring': 'Directional Drilling', 'directional drilling': 'Directional Drilling',
          bulldozer: 'Bulldozer', dozer: 'Bulldozer', drilling: 'Drilling', explosives: 'Explosives',
          'farm equipment': 'Farm Equipment', grader: 'Grader/Scraper', scraper: 'Grader/Scraper',
          'hand tools': 'Hand Tools', hand: 'Hand Tools', milling: 'Milling', probing: 'Probing Device',
          'probing device': 'Probing Device', trencher: 'Trencher', vacuum: 'Vacuum Equipment', 'vacuum equipment': 'Vacuum Equipment'
        };
        const mappedEq = [...new Set((ticket.specs.equipment || []).map(e => eqMap[e.trim().toLowerCase()] || 'Unknown/Other'))];
        
        const script = document.createElement('script');
        script.textContent = \`
          (function() {
            const jq = window.$ || window.jQuery;
            if (!jq) return;
            
            const dateEl = document.querySelector('input#tkt-A-start-date');
            if (dateEl) {
              let targetDate = "";
              const dp = jq(dateEl).data('datepicker');
              if (dp && dp.settings && dp.settings.minDate) {
                const minDate = dp.settings.minDate;
                if (minDate instanceof Date) {
                  targetDate = \\\`\\\${String(minDate.getMonth()+1).padStart(2,'0')}/\\\${String(minDate.getDate()).padStart(2,'0')}/\\\${minDate.getFullYear()}\\\`;
                } else if (typeof minDate === 'string') {
                  targetDate = minDate;
                }
              }
              if (!targetDate) {
                const d = new Date();
                let added = 0;
                while (added < 2) {
                  d.setDate(d.getDate() + 1);
                  if (d.getDay() !== 0 && d.getDay() !== 6) added++;
                }
                targetDate = \\\`\\\${String(d.getMonth()+1).padStart(2,'0')}/\\\${String(d.getDate()).padStart(2,'0')}/\\\${d.getFullYear()}\\\`;
              }
              dateEl.value = targetDate;
              jq(dateEl).trigger('change');
            }
            
            const timeEl = document.querySelector('input#timepicker');
            if (timeEl) {
              timeEl.value = '12:00 AM';
              jq(timeEl).trigger('change');
            }
            
            const selectEl = document.querySelector('select#type_of_equipment');
            if (selectEl) {
              const options = \\\${JSON.stringify(mappedEq)};
              Array.from(selectEl.options).forEach(opt => {
                opt.selected = options.some(o => opt.text.toLowerCase().replace(/\\\\s+/g, '') === o.toLowerCase().replace(/\\\\s+/g, ''));
              });
              jq(selectEl).trigger('change');
              if (jq(selectEl).multiselect) jq(selectEl).multiselect('refresh');
            }
          })();
        \`;
        document.documentElement.appendChild(script);
        script.remove();
        
        updateBanner('Form filled! Review, adjust and click Next.', true, false);
        return;
      }
      
      // 4. Confirmation / Scrape
      const bodyText = document.body.innerText || '';
      let ticketNum = '';
      const numEl = document.querySelector('.ticket-number, [data-ticket-number], #ticketNumber');
      if (numEl) ticketNum = numEl.textContent.trim();
      if (!ticketNum) {
        const m = bodyText.match(/ticket\\\\s*(?:#|number|no\\\\.?)\\\\s*:?\\\\s*([A-Z0-9-]{5,})/i) || bodyText.match(/\\\\b(\\\\d{8,})\\\\b/);
        if (m) ticketNum = m[1].trim();
      }
      
      if (ticketNum) {
        updateBanner('Scraping Ticket #' + ticketNum + '...', false, false);
        const postRes = await fetch('${origin}/api/dig-tickets/' + ticketId + '/file', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ticketNumber: ticketNum })
        });
        if (postRes.ok) {
          updateBanner('Filing Completed! Ticket #' + ticketNum + ' saved! Close this tab.', true, false);
        } else {
          throw new Error('Database sync failed');
        }
      } else {
        updateBanner('No ticket number found yet. Make sure you are on the confirmation screen.', false, true);
      }
      
    } catch(err) {
      updateBanner('Error: ' + err.message, false, true);
    }
  })();`;
  
  return `javascript:${code.replace(/\s+/g, " ")}`;
}
