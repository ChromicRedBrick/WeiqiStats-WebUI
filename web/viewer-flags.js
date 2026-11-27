/* One flag mapping for every viewer surface; all images are local and retain their proportions. */
(function (root) {
  const countries = {
    ARG:'阿根廷', BRA:'巴西', CAN:'加拿大', CHN:'中国', CZE:'捷克', FRA:'法国', GBR:'英国',
    GER:'德国', HKG:'中国香港', INA:'印度尼西亚', ISR:'以色列', JPN:'日本', KOR:'韩国',
    MAS:'马来西亚', NED:'荷兰', POL:'波兰', ROM:'罗马尼亚', RUS:'俄罗斯', SGP:'新加坡',
    SVK:'斯洛伐克', THA:'泰国', TPE:'中华台北', UKR:'乌克兰', USA:'美国', VNM:'越南'
  };
  const textCountries = {
    AUS:'澳大利亚', AUT:'奥地利', AZE:'阿塞拜疆', BEL:'比利时', BIH:'波黑', BLR:'白俄罗斯',
    BRN:'文莱', BUL:'保加利亚', CHI:'智利', CRC:'哥斯达黎加', CRO:'克罗地亚', DEN:'丹麦',
    ECU:'厄瓜多尔', ESP:'西班牙', FIN:'芬兰', HUN:'匈牙利', IND:'印度', IRL:'爱尔兰',
    ITA:'意大利', LTU:'立陶宛', LUX:'卢森堡', MAC:'中国澳门', MEX:'墨西哥', MNG:'蒙古',
    NOR:'挪威', NZL:'新西兰', POR:'葡萄牙', PRK:'朝鲜', RSA:'南非', SLO:'斯洛文尼亚',
    SRB:'塞尔维亚', SUI:'瑞士', SWE:'瑞典', VEN:'委内瑞拉'
  };
  const aliases = {
    AR:'ARG', BR:'BRA', CA:'CAN', CN:'CHN', CZ:'CZE', FR:'FRA', GB:'GBR', UK:'GBR',
    DE:'GER', DEU:'GER', HK:'HKG', ID:'INA', IDN:'INA', IL:'ISR', JP:'JPN', KR:'KOR',
    MY:'MAS', MYS:'MAS', NL:'NED', NLD:'NED', PL:'POL', RO:'ROM', ROU:'ROM', RU:'RUS',
    SG:'SGP', SIN:'SGP', SK:'SVK', TH:'THA', TW:'TPE', TWN:'TPE', UA:'UKR', US:'USA', VN:'VNM', VIE:'VNM',
    '中国':'CHN', '中國':'CHN', '韩国':'KOR', '韓國':'KOR', '日本':'JPN',
    '中华台北':'TPE', '中華台北':'TPE', '中国台北':'TPE', '中國台北':'TPE', '台湾':'TPE', '台灣':'TPE', '臺灣':'TPE',
    '香港':'HKG', '中国香港':'HKG', '中國香港':'HKG', '美国':'USA', '美國':'USA',
    '新加坡':'SGP', '马来西亚':'MAS', '馬來西亞':'MAS', '印尼':'INA', '印度尼西亚':'INA',
    '欧洲':'EUR', '歐洲':'EUR', 'EUROPE':'EUR'
  };
  const escape = value => String(value ?? '').replace(/[&<>"']/g, ch => ({
    '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'
  })[ch]);
  function normalize(value) {
    const code = String(value || '').trim().toUpperCase();
    return aliases[code] || code;
  }
  function info(value) {
    const code = normalize(value), name = countries[code];
    if (name) return {code, name, file:`assets/flags/${code}.svg`,
      title: code === 'TPE' ? '中华台北' : name};
    if (textCountries[code]) return {code, name:textCountries[code], title:textCountries[code]};
    if (code === 'EUR') return {code, name:'欧洲', title:'欧洲'};
    return {code:code || 'UNK', name:code && code !== 'UNK' ? code : '—', title:'地区未知'};
  }
  function html(value) {
    const flag = info(value);
    return flag.file ? `<img class="country-flag" src="${flag.file}" alt="${flag.name}" title="${flag.title}" data-country="${flag.code}" width="24" height="16">`
      : `<span class="country-label" title="${escape(flag.title)}" data-country="${escape(flag.code)}">${escape(flag.name)}</span>`;
  }
  const api = {countries, aliases, normalize, info, html};
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.GoViewerFlags = api;
})(typeof window === 'undefined' ? globalThis : window);
