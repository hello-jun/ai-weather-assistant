import type { WeatherResult } from "@/lib/tools";

const WEATHER_STYLES: Record<string, { gradient: string; icon: string }> = {
  晴朗: { gradient: "from-orange-400 to-amber-300", icon: "☀️" },
  大部晴朗: { gradient: "from-orange-300 to-yellow-200", icon: "🌤️" },
  多云: { gradient: "from-slate-400 to-gray-300", icon: "⛅" },
  阴天: { gradient: "from-gray-500 to-gray-400", icon: "☁️" },
  有雾: { gradient: "from-gray-400 to-stone-300", icon: "🌫️" },
  霜雾: { gradient: "from-gray-400 to-stone-300", icon: "🌫️" },
  小雨: { gradient: "from-blue-400 to-slate-400", icon: "🌦️" },
  中雨: { gradient: "from-blue-500 to-slate-500", icon: "🌧️" },
  大雨: { gradient: "from-blue-600 to-slate-600", icon: "🌧️" },
  小到中雨: { gradient: "from-blue-500 to-slate-400", icon: "🌧️" },
  中到大雨: { gradient: "from-blue-600 to-slate-500", icon: "🌧️" },
  大到暴雨: { gradient: "from-blue-700 to-slate-600", icon: "🌧️" },
  小雪: { gradient: "from-blue-200 to-slate-200", icon: "🌨️" },
  中雪: { gradient: "from-blue-300 to-slate-200", icon: "❄️" },
  大雪: { gradient: "from-blue-200 to-white", icon: "❄️" },
  阵雨: { gradient: "from-blue-400 to-slate-400", icon: "🌦️" },
  中等阵雨: { gradient: "from-blue-500 to-slate-500", icon: "🌧️" },
  大阵雨: { gradient: "from-blue-600 to-slate-600", icon: "🌧️" },
  雷暴: { gradient: "from-purple-600 to-slate-700", icon: "⛈️" },
  冰雹雷暴: { gradient: "from-purple-700 to-slate-800", icon: "⛈️" },
  特大冰雹雷暴: { gradient: "from-purple-800 to-slate-900", icon: "⛈️" },
};

const DEFAULT_STYLE = { gradient: "from-sky-400 to-blue-300", icon: "🌡️" };

export function WeatherCard({ data }: { data: WeatherResult }) {
  const style = WEATHER_STYLES[data.current.weather] ?? DEFAULT_STYLE;

  return (
    <div
      className={`rounded-xl bg-gradient-to-br ${style.gradient} p-4 text-white shadow-md`}
    >
      {/* City & Date */}
      <div className="flex items-baseline justify-between mb-3">
        <h3 className="text-base font-semibold">{data.city}</h3>
        <span className="text-xs opacity-80">{data.date}</span>
      </div>

      {/* Main: temp + weather */}
      <div className="flex items-center gap-3 mb-4">
        <span className="text-5xl font-bold leading-none">
          {Math.round(data.current.temperature)}°
        </span>
        <div className="flex flex-col">
          <span className="text-3xl">{style.icon}</span>
          <span className="text-sm font-medium mt-0.5">
            {data.current.weather}
          </span>
        </div>
      </div>

      {/* Metrics row */}
      <div className="flex justify-between text-xs opacity-90 border-t border-white/20 pt-3">
        <div className="text-center">
          <div className="font-medium">{data.daily.minTemp}° / {data.daily.maxTemp}°</div>
          <div className="opacity-70 mt-0.5">最低/最高</div>
        </div>
        <div className="text-center">
          <div className="font-medium">{data.current.humidity}%</div>
          <div className="opacity-70 mt-0.5">湿度</div>
        </div>
        <div className="text-center">
          <div className="font-medium">{data.current.windSpeed} km/h</div>
          <div className="opacity-70 mt-0.5">风速</div>
        </div>
      </div>
    </div>
  );
}
