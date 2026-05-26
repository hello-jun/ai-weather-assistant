import type { A2UIComponentProps, CatalogRegistry } from "@/lib/a2ui-catalog";
import { WEATHER_CATALOG_ID } from "@/lib/a2ui-catalog";
import { getByPointer } from "@/lib/a2ui-catalog";
import { WeatherCard } from "./weather-card";
import { TipsCard } from "./tips-card";
import type { WeatherResult } from "@/lib/tools";

function A2UIWeatherCard({ dataModel }: A2UIComponentProps) {
  const weatherData = getByPointer(dataModel || {}, "/weather") as WeatherResult | undefined;
  if (!weatherData?.city || !weatherData?.current) {
    return (
      <div className="animate-pulse p-4 bg-gray-100 rounded-xl text-center text-sm text-gray-400">
        加载天气数据...
      </div>
    );
  }
  return <WeatherCard data={weatherData} />;
}

function A2UITipsCard({ dataModel }: A2UIComponentProps) {
  let tips = getByPointer(dataModel || {}, "/tips") as string[] | undefined;
  if (!tips) {
    tips = getByPointer(dataModel || {}, "/weather/tips") as string[] | undefined;
  }
  if (!tips || !Array.isArray(tips) || tips.length === 0) return null;
  return <TipsCard tips={tips} />;
}

function A2UIText({ text, variant, children }: A2UIComponentProps & { text?: string; variant?: string }) {
  const cls = variant === "h1" ? "text-lg font-semibold" : "text-sm";
  return <div className={cls}>{text || children}</div>;
}

function A2UIColumn({ children }: A2UIComponentProps) {
  return <div className="flex flex-col gap-2">{children}</div>;
}

function A2UIRow({ children }: A2UIComponentProps) {
  return <div className="flex flex-row gap-2 items-center">{children}</div>;
}

export const weatherCatalogRegistry: CatalogRegistry = {
  [WEATHER_CATALOG_ID]: {
    WeatherCard: A2UIWeatherCard,
    TipsCard: A2UITipsCard,
    Text: A2UIText,
    Column: A2UIColumn,
    Row: A2UIRow,
  },
};
