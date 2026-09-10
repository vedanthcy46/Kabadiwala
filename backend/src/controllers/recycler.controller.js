import * as recyclerService from '../services/recycler.service.js';
import { resolveLocationCoords } from '../services/location.service.js';
import { ApiError } from '../utils/ApiError.js';

export const getMatchedRecyclers = async (req, res) => {
  const { category, lat, lng, maxDistanceKm, location } = req.query;

  let resolved = null;
  let useLat = lat != null && !isNaN(Number(lat)) ? Number(lat) : null;
  let useLng = lng != null && !isNaN(Number(lng)) ? Number(lng) : null;

  // If location string contains embedded coordinates, extract them
  if (location) {
    const coordsMatch = String(location).match(/(-?\d+\.?\d*)\s*,\s*(-?\d+\.?\d*)/);
    if (coordsMatch) {
      const parsedLat = parseFloat(coordsMatch[1]);
      const parsedLng = parseFloat(coordsMatch[2]);
      if (Number.isFinite(parsedLat) && Number.isFinite(parsedLng) && parsedLat >= -90 && parsedLat <= 90 && parsedLng >= -180 && parsedLng <= 180) {
        useLat = parsedLat;
        useLng = parsedLng;
        resolved = { name: location, lat: useLat, lng: useLng };
      }
    }
  }

  if (useLat == null || useLng == null) {
    if (location) {
      resolved = await resolveLocationCoords(location);
      useLat = resolved.lat;
      useLng = resolved.lng;
    }
  } else if (location && !resolved) {
    resolved = { name: location, lat: useLat, lng: useLng };
  }

  if (useLat == null || useLng == null) {
    throw new ApiError(400, 'Provide either a location (city/state) or lat+lng for matching');
  }

  const recyclers = await recyclerService.matchAuthorizedRecyclers(
    category,
    useLat,
    useLng,
    maxDistanceKm,
    location
  );

  res.status(200).json({
    success: true,
    count: recyclers.length,
    location: resolved ? { name: location, lat: useLat, lng: useLng } : undefined,
    data: recyclers,
  });
};

export const getNearbyRecyclers = async (req, res, next) => {
  try {
    const { lat, lng, radiusKm, limit, material, search, location } = req.query;

    let useLat = lat != null && !isNaN(Number(lat)) ? Number(lat) : null;
    let useLng = lng != null && !isNaN(Number(lng)) ? Number(lng) : null;
    let resolved = null;

    if (location && (useLat == null || useLng == null)) {
      const coordsMatch = String(location).match(/(-?\d+\.?\d*)\s*,\s*(-?\d+\.?\d*)/);
      if (coordsMatch) {
        const parsedLat = parseFloat(coordsMatch[1]);
        const parsedLng = parseFloat(coordsMatch[2]);
        if (Number.isFinite(parsedLat) && Number.isFinite(parsedLng) && parsedLat >= -90 && parsedLat <= 90 && parsedLng >= -180 && parsedLng <= 180) {
          useLat = parsedLat;
          useLng = parsedLng;
          resolved = { name: location, lat: useLat, lng: useLng };
        }
      }
    }

    if (useLat == null || useLng == null) {
      if (location) {
        resolved = await resolveLocationCoords(location);
        useLat = resolved.lat;
        useLng = resolved.lng;
      }
    }

    if (useLat == null || useLng == null) {
      throw new ApiError(400, 'GPS coordinates (lat and lng) or a location name are required');
    }

    const recyclers = await recyclerService.getNearbyAuthorizedRecyclers({
      lat: useLat,
      lng: useLng,
      radiusKm,
      limit,
      material,
      search,
    });

    res.status(200).json({
      success: true,
      count: recyclers.length,
      center: { lat: useLat, lng: useLng, location: resolved?.name || location || null },
      data: recyclers,
    });
  } catch (err) {
    next(err);
  }
};