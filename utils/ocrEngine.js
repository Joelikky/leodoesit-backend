function parseHoursFromText(text) {

  const lines = text
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean);

  const explicitTotalRegexes = [
    /(?:total\s*hours|total\s*hrs|hours\s*worked|week\s*total|total)\s*[:=\-_]?\s*(\d+(?:\.\d+)?)/i,
    /(\d+(?:\.\d+)?)\s*(?:total\s*hours|total\s*hrs|hours\s*total)/i
  ];

  let accumulatedTotalHours = 0;
  const processedTotals = new Set();

  for (let i = 0; i < lines.length; i++) {

    const currentLine = lines[i];
    const nextLine = i + 1 < lines.length ? lines[i + 1] : '';

    // Skip timestamps
    if (
      currentLine.includes(':') &&
      (
        currentLine.toLowerCase().includes('am') ||
        currentLine.toLowerCase().includes('pm')
      )
    ) {
      continue;
    }

    // ------------------------------------
    // CASE 1
    // Total 40
    // ------------------------------------

    for (const regex of explicitTotalRegexes) {

      const match = currentLine.match(regex);

      if (match && match[1]) {

        const value = parseFloat(match[1]);

        if (
          value > 0 &&
          value <= 60
        ) {

          const key = `${i}_${value}`;

          if (!processedTotals.has(key)) {

            processedTotals.add(key);

            accumulatedTotalHours += value;

            console.log(
              `[OCR TOTAL FOUND] +${value} hrs`
            );
          }
        }

        break;
      }
    }

    // ------------------------------------
    // CASE 2
    // Total
    // 40
    // ------------------------------------

    if (
      currentLine.toLowerCase() === 'total' &&
      nextLine &&
      /^\d+(?:\.\d+)?$/.test(nextLine)
    ) {

      const value = parseFloat(nextLine);

      if (
        value > 0 &&
        value <= 60
      ) {

        const key = `split_${i}_${value}`;

        if (!processedTotals.has(key)) {

          processedTotals.add(key);

          accumulatedTotalHours += value;

          console.log(
            `[OCR SPLIT TOTAL FOUND] +${value} hrs`
          );
        }

        i++;
      }
    }

    // ------------------------------------
    // CASE 3
    // Total Hours
    // 40
    // ------------------------------------

    const combinedLine =
      `${currentLine} ${nextLine}`.trim();

    for (const regex of explicitTotalRegexes) {

      const match =
        combinedLine.match(regex);

      if (match && match[1]) {

        const value =
          parseFloat(match[1]);

        if (
          value > 0 &&
          value <= 60
        ) {

          const key =
            `combined_${i}_${value}`;

          if (!processedTotals.has(key)) {

            processedTotals.add(key);

            accumulatedTotalHours += value;

            console.log(
              `[OCR MULTILINE TOTAL FOUND] +${value} hrs`
            );
          }
        }

        break;
      }
    }
  }

  console.log(
    '================================='
  );

  console.log(
    'FINAL OCR TOTAL:',
    accumulatedTotalHours
  );

  console.log(
    '================================='
  );

  if (
    accumulatedTotalHours > 0 &&
    accumulatedTotalHours <= 250
  ) {

    return accumulatedTotalHours;
  }

  // ------------------------------------
  // PASS 2 FALLBACK
  // ------------------------------------

  let aggregatedSum = 0;

  const looseRowRegex =
    /(?:^|\s)(\d+(?:\.\d+)?)\s*(?:h|hr|hrs|hours)?(?:\s|$)/i;

  for (const line of lines) {

    if (
      line.includes('/') ||
      line.includes('-') ||
      line.includes(':') ||
      line.toLowerCase().includes('billing') ||
      line.toLowerCase().includes('invoice')
    ) {
      continue;
    }

    const match =
      line.match(looseRowRegex);

    if (
      match &&
      match[1]
    ) {

      const value =
        parseFloat(match[1]);

      if (
        value >= 4 &&
        value <= 60
      ) {

        aggregatedSum += value;
      }
    }
  }

  if (
    aggregatedSum > 0 &&
    aggregatedSum <= 250
  ) {

    return aggregatedSum;
  }

  return null;
}