// WMO Weather Code → Chinese description
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

export async function getWeather(args: { city: string }): Promise<WeatherResult | { error: string }> {
  const { city } = args;

  try {
    // Step 1: Geocoding — city name → coordinates
    const geoUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=zh`;
    const geoRes = await fetch(geoUrl);
    if (!geoRes.ok) {
      return { error: "地理编码服务暂时不可用，请稍后重试。" };
    }
    const geoData = await geoRes.json();

    if (!geoData.results?.length) {
      return { error: `未找到城市「${city}」的天气数据，请确认城市名称是否正确。` };
    }

    const { latitude, longitude, name, country } = geoData.results[0];

    // Step 2: Fetch weather forecast
    const weatherUrl = `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,relative_humidity_2m,wind_speed_10m,weather_code&daily=temperature_2m_max,temperature_2m_min,weather_code&forecast_days=1&timezone=auto`;
    const weatherRes = await fetch(weatherUrl);
    if (!weatherRes.ok) {
      return { error: "天气数据服务暂时不可用，请稍后重试。" };
    }
    const weatherData = await weatherRes.json();

    const location = country ? `${name}(${country})` : name;

    return {
      city: location,
      date: new Date().toISOString().split("T")[0],
      current: {
        temperature: weatherData.current.temperature_2m,
        humidity: weatherData.current.relative_humidity_2m,
        windSpeed: weatherData.current.wind_speed_10m,
        weather: wmoToText(weatherData.current.weather_code),
      },
      daily: {
        maxTemp: weatherData.daily.temperature_2m_max[0],
        minTemp: weatherData.daily.temperature_2m_min[0],
        weather: wmoToText(weatherData.daily.weather_code[0]),
      },
    };
  } catch {
    return { error: `查询天气时发生网络错误，请稍后重试。` };
  }
}
