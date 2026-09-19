import json
import urllib.request
import urllib.parse
import os
import math

# Douglas-Peucker point-to-line distance
def point_line_distance(point, start, end):
    if start == end:
        return math.hypot(point[0] - start[0], point[1] - start[1])
    n = abs((end[0] - start[0]) * (start[1] - point[1]) - (start[0] - point[0]) * (end[1] - start[1]))
    d = math.hypot(end[0] - start[0], end[1] - start[1])
    return n / d

# Douglas-Peucker line simplification
def simplify_line(points, epsilon):
    dmax = 0.0
    index = 0
    end = len(points) - 1
    for i in range(1, end):
        d = point_line_distance(points[i], points[0], points[end])
        if d > dmax:
            index = i
            dmax = d
    if dmax > epsilon:
        recResults1 = simplify_line(points[:index+1], epsilon)
        recResults2 = simplify_line(points[index:], epsilon)
        return recResults1[:-1] + recResults2
    else:
        return [points[0], points[end]]

# Iraq Bounding Box: south, west, north, east
BBOXES = {
    "Iraq": "29.0,38.7,37.4,48.6",
    # Can expand to Europe/NA later if this is successful
}

OVERPASS_URL = "http://overpass-api.de/api/interpreter"

def fetch_data(bbox_name, bbox):
    print(f"Fetching highway data for {bbox_name}...")
    
    # Overpass QL to get highways
    query = f"""
    [out:json][timeout:25];
    (
      way["highway"="motorway"]({bbox});
      way["highway"="trunk"]({bbox});
      way["highway"="primary"]({bbox});
    );
    out body;
    >;
    out skel qt;
    """
    
    # URL encode and request
    data = urllib.parse.urlencode({'data': query}).encode('utf-8')
    req = urllib.request.Request(OVERPASS_URL, data=data)
    
    try:
        with urllib.request.urlopen(req) as response:
            result = json.loads(response.read().decode('utf-8'))
            return result
    except Exception as e:
        print(f"Failed to fetch data for {bbox_name}: {e}")
        return None

def process_osm(osm_data):
    # Mapping points
    nodes = {}
    for element in osm_data.get('elements', []):
        if element['type'] == 'node':
            nodes[element['id']] = (element['lat'], element['lon'])
            
    # Assembling ways
    roads = []
    total_original_points = 0
    total_simplified_points = 0
    
    for element in osm_data.get('elements', []):
        if element['type'] == 'way':
            way_nodes = element.get('nodes', [])
            points = []
            for n_id in way_nodes:
                if n_id in nodes:
                    points.append(nodes[n_id])
                    
            if len(points) > 1:
                total_original_points += len(points)
                # Epsilon 0.05 degrees is roughly 5km tolerance on curvature.
                # Smaller epsilon = higher detail curves
                simplified = simplify_line(points, 0.03) 
                
                # Further ensure we don't have super short 2-node segments unless necessary
                if len(simplified) > 1:
                    # Round coords to save bytes
                    rounded = [[round(p[0], 4), round(p[1], 4)] for p in simplified]
                    roads.append(rounded)
                    total_simplified_points += len(rounded)

    print(f"Nodes simplified: {total_original_points} -> {total_simplified_points} (Saved {100 - (total_simplified_points/max(1,total_original_points)*100):.1f}%)")
    return roads

def main():
    all_roads = []
    
    for name, bbox in BBOXES.items():
        data = fetch_data(name, bbox)
        if data:
            roads = process_osm(data)
            all_roads.extend(roads)
            
    # Output to JS
    out_file = os.path.join(os.path.dirname(__file__), '..', 'geo_data.js')
    
    js_content = f"const GEO_DATA_ROADS = {json.dumps(all_roads)};\n"
    
    with open(out_file, 'w', encoding='utf-8') as f:
        f.write(js_content)
        
    print(f"Saved {len(all_roads)} highway segments into geo_data.js")

if __name__ == "__main__":
    main()
