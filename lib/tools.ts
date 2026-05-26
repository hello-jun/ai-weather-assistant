// WMO Weather Code → Chinese description (used by Open-Meteo)
const WMO_MAP: Record<number, string> = {
  0: "晴朗", 1: "大部晴朗", 2: "多云", 3: "阴天",
  45: "有雾", 48: "霜雾",
  51: "小雨", 53: "中雨", 55: "大雨",
  61: "小到中雨", 63: "中到大雨", 65: "大到暴雨",
  71: "小雪", 73: "中雪", 75: "大雪",
  80: "阵雨", 81: "中等阵雨", 82: "大阵雨",
  95: "雷暴", 96: "冰雹雷暴", 99: "特大冰雹雷暴",
};

function wmoToText(code: number): string {
  return WMO_MAP[code] ?? `未知(${code})`;
}

export const weatherToolDefinition = {
  type: "function" as const,
  function: {
    name: "get_weather",
    description:
      "获取指定城市今天的实时天气情况，包含当前温度、体感温度、湿度、风速、天气描述，以及今日最高/最低气温预报",
    parameters: {
      type: "object" as const,
      properties: {
        city: {
          type: "string",
          description: "城市中文名称，例如：北京、上海、深圳、杭州、成都",
        },
      },
      required: ["city"],
    },
  },
};

export interface WeatherResult {
  city: string;
  date: string;
  current: {
    temperature: number;
    humidity: number;
    windSpeed: number;
    weather: string;
  };
  daily: {
    maxTemp: number;
    minTemp: number;
    weather: string;
  };
}

/** Try Open-Meteo (geocoding + forecast) */
async function getWeatherFromOpenMeteo(city: string): Promise<WeatherResult> {
  // Step 1: Geocoding
  const geoUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=zh`;
  const geoRes = await fetch(geoUrl, { signal: AbortSignal.timeout(8000) });
  if (!geoRes.ok) throw new Error(`geocoding HTTP ${geoRes.status}`);

  const geoData = await geoRes.json();
  if (!geoData.results?.length) throw new Error("city_not_found");

  const { latitude, longitude, name, country } = geoData.results[0];

  // Step 2: Forecast (with retry for 5xx)
  const weatherUrl = `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,relative_humidity_2m,wind_speed_10m,weather_code&daily=temperature_2m_max,temperature_2m_min,weather_code&forecast_days=1&timezone=auto`;
  let weatherRes!: Response;
  for (let attempt = 0; attempt < 2; attempt++) {
    weatherRes = await fetch(weatherUrl, { signal: AbortSignal.timeout(8000) });
    if (weatherRes.ok) break;
    if (weatherRes.status < 500) throw new Error(`forecast HTTP ${weatherRes.status}`);
    await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
  }
  if (!weatherRes.ok) throw new Error(`forecast HTTP ${weatherRes.status}`);

  const wd = await weatherRes.json();
  const location = country ? `${name}(${country})` : name;

  return {
    city: location,
    date: new Date().toISOString().split("T")[0],
    current: {
      temperature: wd.current.temperature_2m,
      humidity: wd.current.relative_humidity_2m,
      windSpeed: wd.current.wind_speed_10m,
      weather: wmoToText(wd.current.weather_code),
    },
    daily: {
      maxTemp: wd.daily.temperature_2m_max[0],
      minTemp: wd.daily.temperature_2m_min[0],
      weather: wmoToText(wd.daily.weather_code[0]),
    },
  };
}

/** Fallback: wttr.in (free, no API key, accepts city names directly) */
async function getWeatherFromWttr(city: string): Promise<WeatherResult> {
  const url = `https://wttr.in/${encodeURIComponent(city)}?format=j1`;
  const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error(`wttr.in HTTP ${res.status}`);

  const data = await res.json();
  const cur = data.current_condition[0];
  const day = data.weather[0];

  return {
    city,
    date: day.date,
    current: {
      temperature: Number(cur.temp_C),
      humidity: Number(cur.humidity),
      windSpeed: Number(cur.windspeedKmph),
      weather: cur.lang_zh?.[0]?.value || cur.weatherDesc[0].value.trim(),
    },
    daily: {
      maxTemp: Number(day.maxtempC),
      minTemp: Number(day.mintempC),
      weather: cur.lang_zh?.[0]?.value || cur.weatherDesc[0].value.trim(),
    },
  };
}

export async function getWeather(args: { city: string }): Promise<WeatherResult | { error: string }> {
  try {
    try {
      return await getWeatherFromOpenMeteo(args.city);
    } catch {
      // Open-Meteo failed, try wttr.in fallback
      return await getWeatherFromWttr(args.city);
    }
  } catch {
    return { error: `查询天气时发生网络错误，请稍后重试。` };
  }
}
