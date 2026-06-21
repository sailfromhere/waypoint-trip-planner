import type { LatLng, DailyForecast, WeatherProvider } from "./types";

export class MockWeatherProvider implements WeatherProvider {
  async getForecast(
    _location: LatLng,
    startDate: string,
    endDate: string
  ): Promise<DailyForecast[]> {
    const forecasts: DailyForecast[] = [];
    const start = new Date(startDate);
    const end = new Date(endDate);

    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      forecasts.push({
        date: d.toISOString().split("T")[0],
        high: 72 + Math.round(Math.random() * 15),
        low: 48 + Math.round(Math.random() * 10),
        precipitationChance: Math.round(Math.random() * 40),
        summary: "Partly cloudy (mock)",
      });
    }
    return forecasts;
  }
}

export class OpenMeteoWeatherProvider implements WeatherProvider {
  async getForecast(
    location: LatLng,
    startDate: string,
    endDate: string
  ): Promise<DailyForecast[]> {
    const url = new URL("https://api.open-meteo.com/v1/forecast");
    url.searchParams.set("latitude", String(location.lat));
    url.searchParams.set("longitude", String(location.lng));
    url.searchParams.set(
      "daily",
      "temperature_2m_max,temperature_2m_min,precipitation_probability_max,weathercode"
    );
    url.searchParams.set("temperature_unit", "fahrenheit");
    url.searchParams.set("start_date", startDate);
    url.searchParams.set("end_date", endDate);
    url.searchParams.set("timezone", "auto");

    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`Open-Meteo returned ${res.status}`);
    }

    const data = await res.json();
    const daily = data.daily;

    return daily.time.map((date: string, i: number) => ({
      date,
      high: Math.round(daily.temperature_2m_max[i]),
      low: Math.round(daily.temperature_2m_min[i]),
      precipitationChance: daily.precipitation_probability_max[i] ?? 0,
      summary: weatherCodeToSummary(daily.weathercode[i]),
    }));
  }
}

function weatherCodeToSummary(code: number): string {
  if (code <= 1) return "Clear";
  if (code <= 3) return "Partly cloudy";
  if (code <= 48) return "Foggy";
  if (code <= 57) return "Drizzle";
  if (code <= 67) return "Rain";
  if (code <= 77) return "Snow";
  if (code <= 82) return "Rain showers";
  if (code <= 86) return "Snow showers";
  return "Thunderstorm";
}
